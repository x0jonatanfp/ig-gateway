import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { Account } from '../../domain/Account.js';
import type { Publication } from '../../domain/Publication.js';
import { createQuota, type Quota } from '../../domain/Quota.js';
import { PublicationError, invalidRequestError, type PublicationErrorCode } from '../../domain/PublicationError.js';
import type { Comment, DiscoveredAccount, DiscoveredMedia, Insight, InstagramGatewayPort, InstagramMediaItem, PublishRequest } from '../../domain/ports.js';
import type { OnlineFollowersDay } from '../../domain/ActiveHours.js';
import { DEFAULT_AUDIO_LIMIT, MAX_AUDIO_LIMIT, validateAudioVolume, type AudioTrack, type AudioType } from '../../domain/Audio.js';
import { logger } from '../logging/Logger.js';

interface GraphErrorBody { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; is_transient?: boolean }; }
interface GraphResponse {
  id?: string;
  username?: string;
  name?: string;
  media_count?: number;
  followers_count?: number;
  biography?: string;
  website?: string;
  status_code?: string;
  quota_usage?: number;
  config?: { quota_total?: number; quota_duration?: number };
  comments?: { data?: Comment[] };
  data?: Array<Record<string, unknown>>;
  audio?: Array<Record<string, unknown>>;
  paging?: { next?: string; cursors?: { after?: string } };
  business_discovery?: Record<string, unknown> & { media?: { data?: Array<Record<string, unknown>>; paging?: { cursors?: { after?: string } } } };
}

export interface GraphClientOptions {
  version?: string;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  pollTimeoutMs?: number;
  quotaTtlMs?: number;
  maxCallsPerMinute?: number;
  now?: () => number;
  callsLogPath?: string;
  baseUrl?: string;
  dryRun?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Intentos para que Meta se descargue cada imagen (ver createMediaContainer). */
  mediaAttempts?: number;
  mediaRetryDelayMs?: number;
}

type RequestMethod = 'GET' | 'POST' | 'DELETE';

/** Perfil de sondeo del contenedor: una foto está lista casi siempre al primer intento. */
interface PollProfile {
  intervalMs: number;
  maxAttempts: number;
  timeoutMs: number;
}

/** Versión de Graph API por defecto: la última estable de Meta (v27.0, nov-2026). `IG_GRAPH_VERSION` la sobrescribe. */
export const DEFAULT_GRAPH_VERSION = 'v27.0';

export class GraphClient implements InstagramGatewayPort {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly fetcher: typeof fetch;
  private readonly dryRun: boolean;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly quotaTtlMs: number;
  private readonly imagePolls: PollProfile;
  private readonly videoPolls: PollProfile;
  private readonly quotaCache = new Map<string, { quota: Quota; at: number }>();
  private readonly maxCallsPerMinute: number;
  private readonly now: () => number;
  /** Marcas de tiempo de las llamadas a Meta (ventana móvil de 1 minuto). */
  private readonly callTimes: number[] = [];
  /** Ruta del registro compartido de llamadas; sin ella solo se cuenta en memoria. */
  private readonly callsLogPath?: string;
  private callsSinceCompaction = 0;
  /** Llamadas de este proceso aún no confirmadas en el registro compartido. */
  private readonly pendingCalls: number[] = [];
  private readonly mediaAttempts: number;
  private readonly mediaRetryDelayMs: number;

  constructor(options: GraphClientOptions = {}) {
    this.version = options.version ?? process.env.IG_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;
    // Un solo flujo: Instagram API con Facebook Login (token de Página). Es el
    // único donde existen Business Discovery y el resto de lecturas de terceros.
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
    this.fetcher = options.fetcher ?? fetch;
    // Sondeo adaptativo: se pregunta poco al principio y se espacía. Las fotos
    // están listas en uno o dos intentos; los vídeos tardan minutos.
    this.imagePolls = {
      intervalMs: options.pollIntervalMs ?? 2_000,
      maxAttempts: options.maxPollAttempts ?? 15,
      timeoutMs: options.pollTimeoutMs ?? 45_000,
    };
    this.videoPolls = {
      intervalMs: options.pollIntervalMs ?? 3_000,
      maxAttempts: options.maxPollAttempts ?? 60,
      timeoutMs: options.pollTimeoutMs ?? 6 * 60_000,
    };
    // La cuota cambia despacio: se cachea para no preguntarla en cada publicación.
    this.quotaTtlMs = options.quotaTtlMs ?? Number(process.env.IG_QUOTA_TTL_MS ?? 5 * 60_000);
    // Freno suave: si se pasa el tope, se espera en vez de fallar. Una
    // publicación normal gasta ~3 llamadas, así que 30/min no se nota nunca.
    this.maxCallsPerMinute = options.maxCallsPerMinute ?? Number(process.env.IG_MAX_CALLS_PER_MINUTE ?? 30);
    this.now = options.now ?? Date.now;
    // Registro compartido de llamadas: el CLI arranca un proceso por ejecución,
    // así que un contador solo en memoria mentiría entre ejecuciones. Solo se
    // escribe si hay ruta configurada (los tests y las pruebas no lo tocan).
    const callsLogPath = options.callsLogPath ?? process.env.IG_CALLS_LOG;
    if (callsLogPath !== undefined) this.callsLogPath = callsLogPath;
    this.dryRun = options.dryRun ?? process.env.IG_DRY_RUN === '1';
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    // Meta no recibe el fichero: se descarga él la URL pública y, con la
    // subida de la línea en mal estado, esa descarga caduca en unas conexiones
    // y en otras no (subcode 2207003). Cada imagen se reintenta hasta que
    // entra: cada intento abre una conexión nueva y vuelve a sortear el camino.
    this.mediaAttempts = options.mediaAttempts ?? Number(process.env.IG_MEDIA_ATTEMPTS ?? 6);
    this.mediaRetryDelayMs = options.mediaRetryDelayMs ?? Number(process.env.IG_MEDIA_RETRY_DELAY_MS ?? 2_000);
  }

  /** Llamadas hechas a Meta en el último minuto (para diagnosticar el cupo). */
  getCallStats(): { callsLastHour: number; callsLastMinute: number; maxCallsPerMinute: number } {
    const now = this.now();
    const persisted = this.readPersistedCalls();
    const inWindow = (times: readonly number[], windowMs: number): number => times.filter((at) => now - at < windowMs && at <= now).length;
    // Si el registro no se puede leer, se cuenta solo este proceso.
    const times = persisted === null ? this.callTimes : [...persisted, ...this.pendingCalls];
    return {
      callsLastHour: inWindow(times, 60 * 60_000),
      callsLastMinute: inWindow(times, 60_000),
      maxCallsPerMinute: this.maxCallsPerMinute,
    };
  }

  /** Timestamps de llamadas del registro compartido (null si no se puede leer). */
  private readPersistedCalls(): number[] | null {
    if (this.callsLogPath === undefined) return null;
    try {
      return readFileSync(this.callsLogPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(Number)
        .filter((value) => Number.isFinite(value));
    } catch {
      return null;
    }
  }

  private persistCall(at: number): void {
    if (this.callsLogPath === undefined) return;
    this.callsSinceCompaction += 1;
    this.pendingCalls.push(at);
    void appendFile(this.callsLogPath, `${at}\n`, 'utf8')
      .then(() => {
        const index = this.pendingCalls.indexOf(at);
        if (index >= 0) this.pendingCalls.splice(index, 1);
        if (this.callsSinceCompaction >= 1_000) {
          this.callsSinceCompaction = 0;
          return this.compactCallsLog();
        }
        return undefined;
      })
      .catch(() => undefined);
  }

  /** El registro no debe crecer sin fin: se deja solo la última hora. */
  private async compactCallsLog(): Promise<void> {
    if (this.callsLogPath === undefined) return;
    try {
      const cutoff = this.now() - 60 * 60_000;
      const keep = ((await readFile(this.callsLogPath, 'utf8')).split('\n'))
        .filter(Boolean)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= cutoff);
      await writeFile(this.callsLogPath, keep.length > 0 ? `${keep.join('\n')}\n` : '', 'utf8');
    } catch {
      // El registro es diagnóstico: nunca debe romper una publicación.
    }
  }

  async checkAccount(account: Account): Promise<Account> {
    // Con un token de Página, `/me` es la Página: la cuenta de Instagram se pide por su id.
    // El campo `account_type` no existe en esta API.
    const result = await this.request<GraphResponse>(account, `/${account.id}`, { fields: 'id,username,name,media_count,followers_count,biography,website' });
    return {
      ...account,
      id: result.id ?? account.id,
      username: result.username ?? account.username,
      ...(result.name === undefined ? {} : { name: result.name }),
      ...(result.media_count === undefined ? {} : { mediaCount: result.media_count }),
      ...(result.followers_count === undefined ? {} : { followersCount: result.followers_count }),
      ...(result.biography === undefined ? {} : { biography: result.biography }),
      ...(result.website === undefined ? {} : { website: result.website }),
    };
  }

  async getQuota(account: Account, options: { refresh?: boolean } = {}): Promise<Quota> {
    const cached = this.quotaCache.get(account.id);
    const fresh = cached !== undefined
      && options.refresh !== true
      && Date.now() - cached.at < this.quotaTtlMs
      // Con poco margen se pregunta siempre: mejor gastar una llamada que
      // intentar publicar sin cuota.
      && cached.quota.quotaRemaining > cached.quota.quotaTotal * 0.2;
    if (fresh) return cached.quota;

    const result = await this.request<GraphResponse>(account, `/${account.id}/content_publishing_limit`, { fields: 'quota_usage,config' });
    const quota = result.data?.[0] as { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } } | undefined;
    const quotaUsage = quota?.quota_usage ?? result.quota_usage ?? 0;
    const quotaTotal = quota?.config?.quota_total ?? result.config?.quota_total ?? 100;
    const quotaDuration = quota?.config?.quota_duration ?? result.config?.quota_duration;
    const value = createQuota(quotaUsage, quotaTotal, quotaDuration);
    this.quotaCache.set(account.id, { quota: value, at: Date.now() });
    return value;
  }

  /** Tras publicar, la copia cacheada de la cuota sube uno (sin gastar llamada). */
  private bumpCachedQuota(accountId: string): void {
    const cached = this.quotaCache.get(accountId);
    if (!cached) return;
    this.quotaCache.set(accountId, {
      at: Date.now(),
      quota: createQuota(cached.quota.quotaUsage + 1, cached.quota.quotaTotal, cached.quota.quotaDuration),
    });
  }

  async publish(request: PublishRequest): Promise<Publication> {
    if (request.type === 'story' && request.collaborators?.length) {
      throw new PublicationError('Collaborators are not supported for stories', { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    }
    if (request.collaborators && request.collaborators.length > 3) {
      throw new PublicationError('Instagram supports at most 3 collaborators', { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    }
    if (request.audioId !== undefined && request.type !== 'reel') throw invalidRequestError('audio_id is supported only for reels');
    if (request.audioId === undefined && (request.audioVolume !== undefined || request.videoVolume !== undefined)) throw invalidRequestError('audio_volume and video_volume require audio_id');
    if (request.dryRun || this.dryRun) {
      // Dry-run no toca la API: ni containers ni publicación.
      return {
        id: `dry-run-${Date.now()}`,
        accountId: request.account.id,
        mediaIds: request.media.map((item) => item.id),
        type: request.type,
        caption: request.caption.value,
        status: 'created',
        createdAt: new Date().toISOString(),
      };
    }
    const containerIds: string[] = [];
    for (const media of request.media) {
      const containerId = await this.createMediaContainer(request, media);
      // Meta rechaza el contenedor del carrusel si un hijo de vídeo no ha
      // terminado de procesarse: se espera a cada vídeo antes de seguir.
      if (request.type === 'carousel' && isVideoMedia(media)) await this.waitForContainer(request.account, containerId, true);
      containerIds.push(containerId);
    }

    let creationId = containerIds[0] ?? '';
    if (request.type === 'carousel') {
      const carouselParams: Record<string, string> = {
        media_type: 'CAROUSEL',
        children: containerIds.join(','),
        caption: request.caption.value,
      };
      this.addCommonParams(carouselParams, request, { allowAltText: false, allowUserTags: false, allowCollaborators: true, allowLocation: false, allowShareToFeed: false });
      const carousel = await this.request<GraphResponse>(request.account, `/${request.account.id}/media`, carouselParams, 'POST');
      if (!carousel.id) throw new PublicationError('Graph did not return a carousel container id', { code: 'REMOTE_FAILURE', retryable: true });
      creationId = carousel.id;
    }

    const isVideo = request.type === 'reel' || request.media.some(isVideoMedia);
    await this.waitForContainer(request.account, creationId, isVideo);
    const publishStartedAt = this.now();
    let published: GraphResponse;
    try {
      published = await this.request<GraphResponse>(request.account, `/${request.account.id}/media_publish`, { creation_id: creationId }, 'POST');
    } catch (error) {
      // Meta ha llegado a publicar y responder «Application request limit
      // reached» (código 4): reintentar a ciegas duplicó el post el 12-sep.
      // Antes de decidir nada, se comprueba en la cuenta si la pieza salió.
      const verdict = await this.verifyPublication(request.account, request.caption.value, publishStartedAt);
      if (verdict.outcome === 'published') {
        logger.warn(`[ig-gateway] media_publish falló pero la publicación sí salió (${verdict.mediaId}); se da por publicada`);
        this.bumpCachedQuota(request.account.id);
        return {
          id: `publication-${verdict.mediaId}`,
          accountId: request.account.id,
          mediaIds: request.media.map((item) => item.id),
          type: request.type,
          caption: request.caption.value,
          status: 'published',
          remoteId: verdict.mediaId,
          recovered: true,
          createdAt: new Date().toISOString(),
        };
      }
      const detail = error instanceof PublicationError
        ? `${error.code}${error.subcode === undefined ? '' : `/${error.subcode}`}: ${error.message}`
        : String(error);
      if (verdict.outcome === 'absent') {
        // Comprobado en la cuenta: no salió. Reintentar es seguro.
        throw new PublicationError(
          `La publicación no salió (comprobado en la cuenta). ${detail}`,
          { code: 'REMOTE_FAILURE', retryable: true, cause: error },
        );
      }
      throw new PublicationError(
        `No se pudo confirmar la publicación (container ${creationId}). Comprueba la cuenta antes de reintentar. ${detail}`,
        { code: 'UNKNOWN', retryable: false, cause: error },
      );
    }
    if (!published.id) throw new PublicationError('Graph did not return a published media id', { code: 'REMOTE_FAILURE', retryable: true });
    this.bumpCachedQuota(request.account.id);
    return { id: `publication-${published.id}`, accountId: request.account.id, mediaIds: request.media.map((item) => item.id), type: request.type, caption: request.caption.value, status: 'published', remoteId: published.id, createdAt: new Date().toISOString() };
  }

  async publishStory(request: PublishRequest): Promise<Publication> { return this.publish({ ...request, type: 'story' }); }

  /**
   * Biblioteca de audio de Instagram (Audio API del 1-jun-2026). `user_id` es la
   * cuenta que consulta y `audio_type` separa la música de la colección de Meta
   * (`music`) de los sonidos originales de reels (`original_sound`). Sin
   * `search_query`, Meta devuelve lo que está de moda. Solo lectura.
   */
  async searchAudio(account: Account, audioType: AudioType, searchQuery?: string, limit = DEFAULT_AUDIO_LIMIT): Promise<readonly AudioTrack[]> {
    const params: Record<string, string> = {
      audio_type: audioType,
      user_id: account.id,
      limit: String(Math.min(limit, MAX_AUDIO_LIMIT)),
    };
    if (searchQuery !== undefined && searchQuery !== '') params.search_query = searchQuery;
    const response = await this.request<GraphResponse>(account, '/ig_audio', params);
    // La lista llega en `audio` (documentación de la Audio API, comprobado con una cuenta real el 23-nov-2026).
    const entries = response.audio ?? [];
    return entries.flatMap((entry) => {
      const audioId = typeof entry.audio_id === 'string' ? entry.audio_id : undefined;
      if (!audioId) return [];
      // `on_platform_audio_preview_link` es un enlace estable a la app;
      // `download_url` es una descarga temporal de Meta.
      const preview = typeof entry.on_platform_audio_preview_link === 'string'
        ? entry.on_platform_audio_preview_link
        : typeof entry.download_url === 'string' ? entry.download_url : undefined;
      return [{
        audioId,
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
        ...(typeof entry.display_artist === 'string' ? { displayArtist: entry.display_artist } : {}),
        ...(typeof entry.ig_username === 'string' ? { username: entry.ig_username } : {}),
        ...(typeof entry.audio_type === 'string' ? { audioType: entry.audio_type } : {}),
        ...(typeof entry.duration_in_ms === 'number' ? { durationMs: entry.duration_in_ms } : {}),
        ...(preview === undefined ? {} : { previewUrl: preview }),
        ...(typeof entry.cover_artwork_thumbnail_uri === 'string' ? { coverArtworkUri: entry.cover_artwork_thumbnail_uri } : {}),
      } satisfies AudioTrack];
    });
  }

  async moderateComment(account: Account, mediaId: string, action: 'list' | 'reply' | 'hide' | 'unhide' | 'delete' | 'open' | 'close', value?: string): Promise<Comment | Comment[]> {
    if (action === 'list') {
      const response = await this.request<GraphResponse>(account, `/${mediaId}/comments`, { fields: 'id,text,username,timestamp' });
      return (response.data ?? response.comments?.data ?? []) as unknown as Comment[];
    }
    if (action === 'open' || action === 'close') {
      // La Graph API abre/cierra los comentarios de una pieza con comment_enabled.
      const response = await this.request<GraphResponse>(account, `/${mediaId}`, { comment_enabled: action === 'open' ? 'true' : 'false' }, 'POST');
      return { id: response.id ?? mediaId, text: '', username: '', createdAt: new Date().toISOString() };
    }
    if (action === 'delete') {
      // El id aquí es el del comentario, no el de la pieza.
      const response = await this.request<GraphResponse>(account, `/${mediaId}`, {}, 'DELETE');
      return { id: response.id ?? mediaId, text: '', username: '', createdAt: new Date().toISOString() };
    }
    const endpoint = action === 'reply' ? `/${mediaId}/comments` : `/${mediaId}`;
    // Ocultar/mostrar un comentario se hace con hide=true/false.
    const params: Record<string, string> = action === 'reply' ? { message: value ?? '' } : { hide: String(action === 'hide') };
    const result = await this.request<GraphResponse>(account, endpoint, params, 'POST');
    return { id: result.id ?? mediaId, text: value ?? '', username: '', createdAt: new Date().toISOString(), ...(action === 'hide' || action === 'unhide' ? { hidden: action === 'hide' } : {}) };
  }

  async getInsights(account: Account, mediaId?: string): Promise<readonly Insight[]> {
    // Insights de una pieza: sin `period`. De la cuenta: `period` es obligatorio y
    // los totales del día llevan metric_type=total_value.
    const response = mediaId
      ? await this.request<GraphResponse>(account, `/${mediaId}/insights`, { metric: 'comments,likes,reach,views,total_interactions' })
      : await this.request<GraphResponse>(account, `/${account.id}/insights`, { metric: 'reach,profile_views', period: 'day', metric_type: 'total_value' });
    return (response.data ?? []).map((entry) => {
      const totals = entry.total_value as { value?: number } | undefined;
      const values = Array.isArray(entry.values)
        ? (entry.values as Array<{ value?: number; end_time?: string }>).map((item) => ({ value: item.value ?? 0, ...(item.end_time === undefined ? {} : { endTime: item.end_time }) }))
        : totals?.value === undefined ? [] : [{ value: totals.value }];
      return { name: String(entry.name ?? ''), values };
    });
  }

  /**
   * Seguidores en línea por hora (`online_followers`). Meta solo guarda 30 días y
   * sin `since`/`until` devuelve los dos últimos, que suelen llegar vacíos porque
   * aún no están calculados: se piden 29 días para tener datos de verdad.
   */
  async getOnlineFollowers(account: Account): Promise<readonly OnlineFollowersDay[]> {
    const until = Math.floor(Date.now() / 1000);
    const since = until - 29 * 86_400;
    const response = await this.request<GraphResponse>(account, `/${account.id}/insights`, { metric: 'online_followers', period: 'lifetime', since: String(since), until: String(until) });
    const values = response.data?.[0]?.values;
    if (!Array.isArray(values)) return [];
    return (values as Array<{ value?: Record<string, number>; end_time?: string }>).map((item) => ({ endTime: item.end_time ?? '', counts: item.value ?? {} }));
  }

  /**
   * Piezas publicadas en la cuenta. `instagramPostId` guarda el id de media,
   * que no forma parte de ninguna URL: el permalink corto (instagram.com/p/<id>)
   * solo se puede obtener preguntándoselo a la API, así que es este método el
   * que da la URL canónica de cada pieza.
   */
  async listMedia(account: Account, limit = 50): Promise<readonly InstagramMediaItem[]> {
    const items: InstagramMediaItem[] = [];
    let after = '';
    // El tope evita que una cuenta enorme dispare llamadas sin control; con 50
    // por página cubre de sobra cuentas del tamaño de la comunidad.
    for (let page = 0; page < 10; page += 1) {
      const params: Record<string, string> = { fields: 'id,permalink,caption,media_type,timestamp', limit: String(Math.min(limit, 50)) };
      if (after) params.after = after;
      const response = await this.request<GraphResponse>(account, `/${account.id}/media`, params);
      for (const entry of response.data ?? []) {
        const id = typeof entry.id === 'string' ? entry.id : undefined;
        const permalink = typeof entry.permalink === 'string' ? entry.permalink : undefined;
        if (!id || !permalink) continue;
        items.push({
          id,
          permalink,
          caption: typeof entry.caption === 'string' ? entry.caption : '',
          ...(typeof entry.media_type === 'string' ? { mediaType: entry.media_type } : {}),
          ...(typeof entry.timestamp === 'string' ? { timestamp: entry.timestamp } : {}),
        });
      }
      after = response.paging?.cursors?.after ?? '';
      if (!response.paging?.next || !after || items.length >= limit) break;
    }
    return items.slice(0, limit);
  }

  /**
   * Datos públicos de otra cuenta Business/Creator (Business Discovery).
   * Es de solo lectura y se ejecuta sobre la cuenta del token, identificando
   * el objetivo por username. Pagina el edge `media` con cursores hasta
   * `limit` piezas (tope 100). Las URLs de media caducan: hay que descargarlas.
   */
  async discoverAccount(account: Account, username: string, limit = 12): Promise<DiscoveredAccount> {
    const cap = Math.min(limit, 100);
    const media: DiscoveredMedia[] = [];
    let profile: DiscoveredAccount | undefined;
    let after = '';
    for (let page = 0; page < 10; page += 1) {
      const pageSize = Math.min(Math.max(cap - media.length, 1), 25);
      const mediaEdge = `media.limit(${pageSize})${after ? `.after(${after})` : ''}{id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_type,media_url}}`;
      const fields = `business_discovery.username(${username}){username,name,biography,website,profile_picture_url,followers_count,media_count,${mediaEdge}}`;
      const response = await this.discoveryRequest(account, fields);
      const target = response.business_discovery;
      if (!target) throw new PublicationError('Business Discovery returned no account data', { code: 'NOT_FOUND', retryable: false, status: 404 });
      profile ??= {
        username: typeof target.username === 'string' ? target.username : username,
        ...(typeof target.name === 'string' ? { name: target.name } : {}),
        ...(typeof target.biography === 'string' ? { biography: target.biography } : {}),
        ...(typeof target.website === 'string' ? { website: target.website } : {}),
        ...(typeof target.profile_picture_url === 'string' ? { profilePictureUrl: target.profile_picture_url } : {}),
        ...(typeof target.followers_count === 'number' ? { followersCount: target.followers_count } : {}),
        ...(typeof target.media_count === 'number' ? { mediaCount: target.media_count } : {}),
        media: [],
      };
      for (const entry of target.media?.data ?? []) {
        const id = typeof entry.id === 'string' ? entry.id : undefined;
        const permalink = typeof entry.permalink === 'string' ? entry.permalink : undefined;
        if (!id || !permalink) continue;
        const children = Array.isArray((entry.children as { data?: unknown } | undefined)?.data)
          ? ((entry.children as { data: Array<Record<string, unknown>> }).data).map((child) => ({
            ...(typeof child.media_type === 'string' ? { mediaType: child.media_type } : {}),
            ...(typeof child.media_url === 'string' ? { mediaUrl: child.media_url } : {}),
          }))
          : undefined;
        media.push({
          id,
          permalink,
          caption: typeof entry.caption === 'string' ? entry.caption : '',
          ...(typeof entry.media_type === 'string' ? { mediaType: entry.media_type } : {}),
          ...(typeof entry.media_url === 'string' ? { mediaUrl: entry.media_url } : {}),
          ...(typeof entry.thumbnail_url === 'string' ? { thumbnailUrl: entry.thumbnail_url } : {}),
          ...(typeof entry.timestamp === 'string' ? { timestamp: entry.timestamp } : {}),
          ...(typeof entry.like_count === 'number' ? { likeCount: entry.like_count } : {}),
          ...(typeof entry.comments_count === 'number' ? { commentsCount: entry.comments_count } : {}),
          ...(children === undefined ? {} : { children }),
        });
      }
      after = target.media?.paging?.cursors?.after ?? '';
      if (!after || media.length >= cap || (target.media?.data ?? []).length === 0) break;
    }
    return { ...(profile as DiscoveredAccount), media: media.slice(0, cap) };
  }

  /** Business Discovery devuelve «Invalid user id» (código 110) si el objetivo no es profesional o no existe. */
  private async discoveryRequest(account: Account, fields: string): Promise<GraphResponse> {
    try {
      return await this.request<GraphResponse>(account, `/${account.id}`, { fields });
    } catch (error) {
      if (error instanceof PublicationError && error.code === 'INVALID_REQUEST' && /invalid user id|cannot find|does not exist/i.test(error.message)) {
        throw new PublicationError(`Target account not found or not a Business/Creator account (${error.message})`, { code: 'NOT_FOUND', retryable: false, status: 404, ...(error.subcode === undefined ? {} : { subcode: error.subcode }), ...(error.fbtrace === undefined ? {} : { fbtrace: error.fbtrace }) });
      }
      throw error;
    }
  }

  /**
   * Crea el contenedor de una imagen, reintentando la descarga de Meta.
   *
   * Meta no recibe el fichero: se lo descarga él de nuestra URL pública, y
   * cuando esa descarga no termina a tiempo responde con el subcode 2207003
   * («Timeout») sin devolver contenedor. El fallo es de la conexión, no del
   * fichero, así que se repite la misma petición: cada intento es una
   * conexión nueva. En los reintentos se añade un parámetro a la URL para que
   * Meta no reutilice la descarga fallida que tenga en caché.
   */
  private async createMediaContainer(request: PublishRequest, media: PublishRequest['media'][number]): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.mediaAttempts; attempt += 1) {
      const params = this.mediaParams(request, this.mediaForAttempt(media, attempt), request.type === 'carousel');
      try {
        const container = await this.request<GraphResponse>(request.account, `/${request.account.id}/media`, params, 'POST');
        if (!container.id) throw new PublicationError('Graph did not return a media container id', { code: 'REMOTE_FAILURE', retryable: true });
        if (attempt > 1) logger.warn(`[ig-gateway] contenedor de ${media.id} creado al intento ${attempt}/${this.mediaAttempts}`);
        return container.id;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof PublicationError && error.retryable;
        if (!retryable || attempt === this.mediaAttempts) throw error;
        const subcode = error.subcode === undefined ? '' : ` (subcode ${error.subcode})`;
        logger.warn(`[ig-gateway] Meta no se descargó ${media.id}${subcode}; reintento ${attempt + 1}/${this.mediaAttempts}`);
        await this.sleep(this.mediaRetryDelayMs);
      }
    }
    throw lastError;
  }

  /** La misma imagen con un parámetro propio del intento, para romper la caché de errores. */
  private mediaForAttempt(media: PublishRequest['media'][number], attempt: number): PublishRequest['media'][number] {
    if (attempt === 1) return media;
    return { ...media, path: `${media.path}${media.path.includes('?') ? '&' : '?'}r=${attempt}` };
  }

  private mediaParams(request: PublishRequest, media: PublishRequest['media'][number], carouselItem: boolean): Record<string, string> {
    // En un carrusel, cada pieza de vídeo va como VIDEO con video_url: si se
    // manda como IMAGE, Meta publica el carrusel sin el vídeo (12-nov).
    const carouselVideo = carouselItem && isVideoMedia(media);
    const params: Record<string, string> = {
      media_type: request.type === 'reel' ? 'REELS' : request.type === 'story' ? 'STORIES' : carouselVideo ? 'VIDEO' : 'IMAGE',
      ...(request.type === 'reel' || carouselVideo ? { video_url: media.path } : { image_url: media.path }),
    };
    if (carouselItem) params.is_carousel_item = 'true';
    if (request.type !== 'carousel') params.caption = request.caption.value;
    // Meta responde «(#100) The param alt_text is not supported for VIDEO».
    this.addCommonParams(params, request, { allowAltText: !carouselVideo, allowUserTags: request.type !== 'carousel', allowCollaborators: request.type === 'photo' || request.type === 'reel', allowLocation: request.type === 'photo', allowShareToFeed: request.type === 'reel' });
    if (request.type === 'reel') {
      const source = media;
      if (source.coverUrl !== undefined) params.cover_url = source.coverUrl;
      if (source.thumbOffset !== undefined) params.thumb_offset = String(source.thumbOffset);
      if (source.audioName !== undefined) params.audio_name = source.audioName;
      if (request.coverUrl !== undefined) params.cover_url = request.coverUrl;
      if (request.thumbOffset !== undefined) params.thumb_offset = String(request.thumbOffset);
      if (request.audioName !== undefined) params.audio_name = request.audioName;
      if (request.audioId !== undefined) {
        // `audio_name` es solo la etiqueta del audio original del vídeo; para
        // usar la biblioteca de Meta hay que mandar el id y la mezcla en
        // `audio_configuration`, un objeto JSON dentro del formulario.
        const configuration: Record<string, string | number> = { audio_id: request.audioId };
        if (request.audioVolume !== undefined) configuration.audio_volume = validateAudioVolume('audio_volume', request.audioVolume);
        if (request.videoVolume !== undefined) configuration.video_volume = validateAudioVolume('video_volume', request.videoVolume);
        params.audio_configuration = JSON.stringify(configuration);
      }
      if (request.shareToFeed !== undefined) params.share_to_feed = String(request.shareToFeed);
    }
    return params;
  }

  private addCommonParams(params: Record<string, string>, request: PublishRequest, options: { allowAltText: boolean; allowUserTags: boolean; allowCollaborators: boolean; allowLocation: boolean; allowShareToFeed: boolean }): void {
    if (options.allowAltText && request.altText !== undefined) params.alt_text = request.altText;
    if (options.allowUserTags && request.userTags !== undefined) params.user_tags = JSON.stringify(request.userTags);
    if (options.allowCollaborators && request.collaborators !== undefined) params.collaborators = request.collaborators.join(',');
    if (options.allowLocation && request.locationId !== undefined) params.location_id = request.locationId;
    if (options.allowShareToFeed && request.shareToFeed !== undefined) params.share_to_feed = String(request.shareToFeed);
  }

  private async waitForContainer(account: Account, containerId: string, isVideo = false): Promise<void> {
    if (!containerId) throw new PublicationError('Graph did not return a container id', { code: 'REMOTE_FAILURE', retryable: true });
    const profile = isVideo ? this.videoPolls : this.imagePolls;
    const startedAt = Date.now();
    let interval = profile.intervalMs;
    for (let attempt = 0; attempt < profile.maxAttempts && Date.now() - startedAt <= profile.timeoutMs; attempt += 1) {
      const result = await this.request<GraphResponse>(account, `/${containerId}`, { fields: 'status_code' });
      if (result.status_code === 'FINISHED') return;
      if (result.status_code === 'ERROR' || result.status_code === 'EXPIRED') throw new PublicationError(`Instagram media container failed with ${result.status_code}`, { code: 'INVALID_REQUEST', retryable: false });
      await this.sleep(interval);
      interval = Math.min(Math.round(interval * 1.5), 15_000);
    }
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    throw new PublicationError(
      `Instagram media container (${isVideo ? 'vídeo' : 'imagen'}) not ready after ${seconds}s; se deja para reintentar`,
      { code: 'REMOTE_FAILURE', retryable: true },
    );
  }

  /**
   * ¿Salió la publicación? Devuelve su id si aparece en la cuenta, `null` si se
   * puede asegurar que no salió, o 'unknown' si no se pudo comprobar.
   * Cuesta una llamada por intento y solo se usa cuando media_publish falla.
   */
  private async verifyPublication(
    account: Account,
    caption: string,
    since: number,
  ): Promise<{ outcome: 'published'; mediaId: string } | { outcome: 'absent' } | { outcome: 'unknown' }> {
    const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
    const wanted = normalize(caption);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await this.sleep(5_000);
      let items: Array<{ id?: string; caption?: string; timestamp?: string }>;
      try {
        const response = await this.request<GraphResponse>(account, `/${account.id}/media`, { fields: 'id,caption,timestamp', limit: '5' });
        items = (response.data ?? []) as Array<{ id?: string; caption?: string; timestamp?: string }>;
      } catch {
        return { outcome: 'unknown' };
      }
      const match = items.find((item) => {
        if (!item.id || item.caption === undefined) return false;
        if (normalize(item.caption) !== wanted) return false;
        return item.timestamp === undefined || Date.parse(item.timestamp) >= since - 60_000;
      });
      if (match?.id) return { outcome: 'published', mediaId: match.id };
    }
    return { outcome: 'absent' };
  }

  /**
   * Freno suave: si en el último minuto ya se han hecho `maxCallsPerMinute`
   * llamadas, espera a que la ventana se abra. Nunca falla por esto.
   */
  private async reserveCall(): Promise<void> {
    const prune = (): void => {
      const now = this.now();
      while (this.callTimes.length > 0 && now - (this.callTimes[0] ?? 0) >= 60_000) this.callTimes.shift();
    };
    prune();
    if (this.callTimes.length >= this.maxCallsPerMinute) {
      const oldest = this.callTimes[0] ?? this.now();
      // Tope de 20 s para no agotar los timeouts de quien llama (habitualmente 30 s).
      const waitMs = Math.min(20_000, Math.max(0, oldest + 60_000 - this.now()));
      if (waitMs > 0) {
        logger.warn(`[ig-gateway] tope de ${this.maxCallsPerMinute} llamadas/minuto: esperando ${Math.round(waitMs / 1000)}s`);
        await this.sleep(waitMs);
      }
      prune();
    }
    this.callTimes.push(this.now());
    this.persistCall(this.now());
  }

  private async request<T extends GraphResponse>(account: Account, path: string, params: Record<string, string>, method: RequestMethod = 'GET'): Promise<T> {
    await this.reserveCall();
    const url = new URL(`/${this.version}${path}`, this.baseUrl);
    const body = new URLSearchParams({ ...params, access_token: account.accessToken });
    // GET y DELETE llevan los parámetros en la query con el token en Bearer;
    // POST los manda en el formulario, como espera la Graph API.
    if (method !== 'POST') for (const [key, value] of body) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url, method === 'POST'
        ? { method, body }
        : { method, headers: { Authorization: `Bearer ${account.accessToken}` } });
    } catch (cause) {
      throw new PublicationError('Instagram Graph request failed before receiving a response', { code: 'REMOTE_FAILURE', retryable: true, cause });
    }
    let payload: T & GraphErrorBody;
    try {
      payload = await response.json() as T & GraphErrorBody;
    } catch (cause) {
      throw new PublicationError('Instagram Graph returned invalid JSON', { code: 'REMOTE_FAILURE', retryable: response.status >= 500, status: response.status, cause });
    }
    if (!response.ok || payload.error) throw this.mapError(response.status, payload.error);
    return payload;
  }

  private mapError(status: number, error?: GraphErrorBody['error']): PublicationError {
    const code = error?.code;
    const subcode = error?.error_subcode;
    const message = error?.message ?? 'Instagram Graph request failed';
    let mapped: PublicationErrorCode = 'UNKNOWN';
    let retryable = status >= 500;
    if (code === 190) mapped = 'AUTHENTICATION';
    else if (code === 10 || code === 200 || message.toLowerCase().includes('does not have permission')) { mapped = 'PERMISSION'; retryable = false; }
    else if (subcode === 9007 || subcode === 9004) { mapped = 'RATE_LIMIT'; retryable = true; }
    else if (code === 4 || code === 17 || code === 613) { mapped = 'RATE_LIMIT'; retryable = true; }
    else if (subcode === 2207109 || subcode === 2207081) { mapped = 'INVALID_REQUEST'; retryable = false; }
    else if (message.toLowerCase().includes('scheduled_publish_time')) { mapped = 'INVALID_REQUEST'; retryable = false; }
    // Meta contesta "Timeout" (subcodigo 2207003) cuando se le atraganta
    // descargar o procesar el medio. Es transitorio por definicion, pero caia en
    // el `status === 400` de abajo y se marcaba como permanente: el 14-sep-2026
    // dejo la cronica del storyteller sin publicar y sin un solo reintento.
    else if (subcode === 2207003 || message.toLowerCase().includes('timeout')) { mapped = 'REMOTE_FAILURE'; retryable = true; }
    else if (status === 400) mapped = 'INVALID_REQUEST';
    // `is_transient` lo manda Meta: si dice que es transitorio, se reintenta
    // (salvo autenticacion y permisos, donde reintentar no aporta nada).
    if (error?.is_transient === true && mapped !== 'AUTHENTICATION' && mapped !== 'PERMISSION') retryable = true;
    return new PublicationError(message, { code: mapped, ...(subcode === undefined ? {} : { subcode }), ...(error?.fbtrace_id === undefined ? {} : { fbtrace: error.fbtrace_id }), retryable, status });
  }
}

/** Un media es vídeo por su tipo MIME o por la extensión (la URL puede llevar query de reintento). */
function isVideoMedia(media: PublishRequest['media'][number]): boolean {
  return media.mimeType?.startsWith('video/') === true || /\.(mp4|mov|m4v)(\?|$)/i.test(media.path);
}
