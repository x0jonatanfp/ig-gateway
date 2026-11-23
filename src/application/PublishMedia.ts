import { randomUUID } from 'node:crypto';
import { validateAudioVolume } from '../domain/Audio.js';
import { Caption } from '../domain/Caption.js';
import { hasCapability, mediaCapabilityFor } from '../domain/Account.js';
import { silentLogger, type LoggerPort } from '../domain/Logger.js';
import { isQuotaExhausted } from '../domain/Quota.js';
import { PublicationError, invalidRequestError } from '../domain/PublicationError.js';
import { validateMediaType, type MediaType } from '../domain/MediaItem.js';
import type { AccountResolverPort, InstagramGatewayPort, MediaInput, MediaStagingPort, PublicationLogPort } from '../domain/ports.js';

export interface PublishMediaInput {
  projectPath: string;
  media: readonly MediaInput[];
  caption?: string;
  type?: MediaType;
  idempotencyKey?: string;
  envFile?: string;
  dryRun?: boolean;
  altText?: string;
  userTags?: readonly { username: string; x?: number; y?: number }[];
  collaborators?: readonly string[];
  locationId?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  thumbOffset?: number;
  audioName?: string;
  audioId?: string;
  audioVolume?: number;
  videoVolume?: number;
}

/** Ajustes inyectables: reintentos y el log del servicio. */
export interface PublishMediaOptions {
  logger?: LoggerPort;
  maxAttempts?: number;
  /** Espera entre intentos (inyectable para no dormir en los tests). */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Sin espera en el primer intento; luego se espacía para no gastar llamadas a lo tonto. */
  retryDelaysMs?: readonly number[];
}

/** Paso en el que va la publicación: un fallo deja en el log en cuál ocurrió. */
type PublishPhase = 'resolve' | 'validate' | 'quota' | 'staging' | 'publish' | 'record' | 'done';

interface PublishRun {
  correlationId: string;
  phase: PublishPhase;
  startedAt: number;
}

export class PublishMedia {
  private readonly logger: LoggerPort;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly retryDelaysMs: readonly number[];

  constructor(
    private readonly gateway: InstagramGatewayPort,
    private readonly staging: MediaStagingPort,
    private readonly resolver: AccountResolverPort,
    private readonly log: PublicationLogPort,
    options: PublishMediaOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.retryDelaysMs = options.retryDelaysMs ?? [0, 5_000, 20_000];
  }

  async execute(input: PublishMediaInput) {
    // El id de correlación se genera aquí, antes del staging, y viaja en todas
    // las líneas de esta publicación (caso de uso y GraphClient): así se
    // reconstruye con un solo filtro en el log. Va por parámetro, nunca global.
    const run: PublishRun = { correlationId: `publish-${randomUUID()}`, phase: 'resolve', startedAt: Date.now() };
    try {
      return await this.publish(input, run);
    } catch (error) {
      await this.recordFailure(error, run);
      throw error;
    }
  }

  /**
   * Todo fallo queda en el log del servicio (fase, código y motivo) y en el
   * registro de publicaciones: sin esto, un error no reintentable (un
   * contenedor en ERROR, por ejemplo) solo se veía en quien llamaba.
   */
  private async recordFailure(error: unknown, run: PublishRun): Promise<void> {
    const publicationError = error instanceof PublicationError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('publish failed', {
      correlationId: run.correlationId,
      phase: run.phase,
      code: publicationError?.code ?? 'UNKNOWN',
      ...(publicationError?.subcode === undefined ? {} : { subcode: publicationError.subcode }),
      retryable: publicationError?.retryable ?? false,
      message,
      durationMs: Date.now() - run.startedAt,
    });
    try {
      await this.log.appendEvent({
        event: 'publish_failed',
        code: publicationError?.code ?? 'UNKNOWN',
        ...(publicationError?.subcode === undefined ? {} : { subcode: publicationError.subcode }),
        retryable: publicationError?.retryable ?? false,
        message,
      });
    } catch {
      // El registro es diagnóstico: si falla, no puede tapar el error real.
    }
  }

  private async publish(input: PublishMediaInput, run: PublishRun) {
    if (input.idempotencyKey) {
      const previous = await this.log.findByIdempotencyKey(input.idempotencyKey);
      if (previous) {
        this.logger.info('publish replay', { correlationId: run.correlationId, publicationId: previous.id, idempotencyKey: input.idempotencyKey });
        return previous;
      }
    }
    const account = await this.resolver.resolve(input.projectPath, input.envFile);
    const type = input.type ?? 'photo';
    // Nunca el texto del pie: tipo, piezas, dry-run y, como mucho, el audio.
    this.logger.info('publish start', {
      correlationId: run.correlationId,
      account: account.username,
      type,
      pieces: input.media.length,
      dryRun: input.dryRun === true,
      ...(input.audioId === undefined ? {} : { audioId: input.audioId }),
      ...(input.audioId === undefined || input.audioVolume === undefined ? {} : { audioVolume: input.audioVolume }),
      ...(input.audioId === undefined || input.videoVolume === undefined ? {} : { videoVolume: input.videoVolume }),
    });
    run.phase = 'validate';
    validateMediaType(type, input.media.length);
    this.validateCapabilities(account, type, input);
    this.validateAudio(input);
    run.phase = 'quota';
    const quota = await this.gateway.getQuota(account);
    if (isQuotaExhausted(quota)) throw new PublicationError('Instagram publishing quota exhausted', { code: 'QUOTA_EXHAUSTED', retryable: false });

    const mediaInput = input.media.map((item) => ({ ...item, type, altText: input.altText, userTags: input.userTags, collaborators: input.collaborators, locationId: input.locationId, shareToFeed: input.shareToFeed, coverUrl: input.coverUrl, thumbOffset: input.thumbOffset, audioName: input.audioName }));
    run.phase = 'staging';
    const stagingStartedAt = Date.now();
    const staged = await this.staging.stage(mediaInput, input.projectPath);
    this.logger.info('media staged', { correlationId: run.correlationId, pieces: staged.length, durationMs: Date.now() - stagingStartedAt });
    try {
      const caption = Caption.create(input.caption ?? '');
      let lastError: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        const delayMs = this.retryDelaysMs[attempt - 1] ?? this.retryDelaysMs.at(-1) ?? 0;
        if (delayMs > 0) await this.sleep(delayMs);
        try {
          run.phase = 'publish';
          const publication = await this.gateway.publish({ account, type, media: staged, caption, altText: input.altText, userTags: input.userTags, collaborators: input.collaborators, locationId: input.locationId, shareToFeed: input.shareToFeed, coverUrl: input.coverUrl, thumbOffset: input.thumbOffset, audioName: input.audioName, audioId: input.audioId, audioVolume: input.audioVolume, videoVolume: input.videoVolume, dryRun: input.dryRun, correlationId: run.correlationId });
          run.phase = 'record';
          const result = input.idempotencyKey ? { ...publication, idempotencyKey: input.idempotencyKey } : publication;
          await this.log.append(result);
          run.phase = 'done';
          this.logger.info('publish done', {
            correlationId: run.correlationId,
            account: account.username,
            publicationId: result.id,
            status: result.status,
            ...(result.remoteId === undefined ? {} : { remoteId: result.remoteId }),
            ...(result.recovered === true ? { recovered: true } : {}),
            durationMs: Date.now() - run.startedAt,
          });
          return result;
        } catch (error) {
          lastError = error;
          if (!(error instanceof PublicationError) || !error.retryable || attempt === this.maxAttempts) throw error;
          this.logger.warn('publish retry', {
            correlationId: run.correlationId,
            attempt,
            maxAttempts: this.maxAttempts,
            nextDelayMs: this.retryDelaysMs[attempt] ?? this.retryDelaysMs.at(-1) ?? 0,
            code: error.code,
            ...(error.subcode === undefined ? {} : { subcode: error.subcode }),
            retryable: error.retryable,
            message: error.message,
          });
          await this.log.appendEvent({ event: 'publish_retry', attempt, code: error.code, subcode: error.subcode });
        }
      }
      throw lastError;
    } finally {
      await this.staging.cleanup(staged);
    }
  }

  private validateCapabilities(account: Parameters<typeof hasCapability>[0], type: MediaType, input: PublishMediaInput): void {
    if (!hasCapability(account, mediaCapabilityFor(type))) this.rejectCapability(`Account does not support ${type} publications`);
    if (input.altText !== undefined && !hasCapability(account, 'alt_text')) this.rejectCapability('Account does not support alt text');
    if (input.userTags !== undefined && !hasCapability(account, 'user_tags')) this.rejectCapability('Account does not support user tags');
    if (input.collaborators !== undefined && !hasCapability(account, 'collaborators')) this.rejectCapability('Account does not support collaborators');
    if (input.locationId !== undefined && !hasCapability(account, 'location')) this.rejectCapability('Account does not support locations');
    if (type === 'story' && input.collaborators?.length) this.rejectCapability('Collaborators are not supported for stories');
    if (input.collaborators && input.collaborators.length > 3) this.rejectCapability('Instagram supports at most 3 collaborators');
    if (input.shareToFeed !== undefined && type !== 'reel') this.rejectCapability('share_to_feed is supported only for reels');
    if (input.audioId !== undefined && type !== 'reel') this.rejectCapability('audio_id is supported only for reels');
  }

  /** Los volúmenes son una entrada inválida (400), no un problema de permisos. */
  private validateAudio(input: PublishMediaInput): void {
    if (input.audioId === undefined && (input.audioVolume !== undefined || input.videoVolume !== undefined)) {
      throw invalidRequestError('audio_volume and video_volume require audio_id');
    }
    if (input.audioVolume !== undefined) validateAudioVolume('audio_volume', input.audioVolume);
    if (input.videoVolume !== undefined) validateAudioVolume('video_volume', input.videoVolume);
  }

  private rejectCapability(message: string): never { throw new PublicationError(message, { code: 'PERMISSION', retryable: false, status: 403 }); }
}
