import { describe, expect, it, vi } from 'vitest';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging, PublishMedia, type PublishMediaInput } from '../src/application/index.js';
import type { Account } from '../src/domain/Account.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { AccountResolverPort, InstagramGatewayPort } from '../src/domain/ports.js';
import { GraphClient } from '../src/infrastructure/graph/GraphClient.js';
import { appLogger, logger } from '../src/infrastructure/logging/Logger.js';

const account: Account = { id: 'account-1', username: 'example_account', accessToken: 'page-token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'quota']) };

type Level = 'debug' | 'info' | 'warn' | 'error';
type LogCall = [string, Record<string, unknown>];

/** Espía los cuatro niveles para leer lo que llega al logger real. */
function capture() {
  const spies = {
    debug: vi.spyOn(logger, 'debug').mockImplementation(() => logger),
    info: vi.spyOn(logger, 'info').mockImplementation(() => logger),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => logger),
    error: vi.spyOn(logger, 'error').mockImplementation(() => logger),
  };
  const calls = (level: Level): LogCall[] => spies[level].mock.calls as unknown as LogCall[];
  const all = (): LogCall[] => (Object.keys(spies) as Level[]).flatMap((level) => calls(level));
  const find = (level: Level, message: string): Record<string, unknown> | undefined => calls(level).find(([name]) => name === message)?.[1];
  return { calls, all, find };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function publisherWith(gateway: InstagramGatewayPort = new MemoryGateway(account), staging = new MemoryStaging(), resolver: AccountResolverPort = new MemoryAccountResolver(account), log = new MemoryLog()) {
  return new PublishMedia(gateway, staging, resolver, log, { logger: appLogger, maxAttempts: 1, sleep: async () => undefined });
}

const photo: PublishMediaInput = { projectPath: '/tmp/project', media: [{ path: '/tmp/photo.jpg' }] };

describe('publication log', () => {
  it('logs start, staging and the final result without the caption', async () => {
    const logs = capture();
    try {
      const result = await publisherWith().execute({
        projectPath: '/tmp/project',
        type: 'reel',
        media: [{ path: '/tmp/clip.mp4' }],
        caption: 'texto privado del pie',
        audioId: 'audio-1',
        audioVolume: 60,
        videoVolume: 40,
        dryRun: true,
      });

      expect(logs.find('info', 'publish start')).toMatchObject({
        account: 'example_account',
        type: 'reel',
        pieces: 1,
        dryRun: true,
        audioId: 'audio-1',
        audioVolume: 60,
        videoVolume: 40,
      });
      expect(logs.find('info', 'media staged')).toMatchObject({ pieces: 1 });
      const done = logs.find('info', 'publish done');
      expect(done).toMatchObject({ publicationId: result.id, status: 'created' });
      expect(typeof done?.durationMs).toBe('number');
      expect(JSON.stringify(logs.all())).not.toContain('texto privado del pie');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('logs the Meta container, every poll and media_publish', async () => {
    const logs = capture();
    try {
      // Enrutado por URL: creación, sondeos y media_publish no compiten por un índice.
      let polls = 0;
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        // La cuota se pregunta antes de publicar: no es un sondeo del contenedor.
        if (url.includes('content_publishing_limit')) return jsonResponse({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
        if (url.includes('/media_publish')) return jsonResponse({ id: 'remote-9' });
        if (init?.method === 'POST') return jsonResponse({ id: 'container-1' });
        polls += 1;
        return jsonResponse(polls === 1 ? { status_code: 'PENDING' } : { status_code: 'FINISHED' });
      });
      const gateway = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
      await publisherWith(gateway).execute(photo);

      expect(logs.find('info', 'media container created')).toMatchObject({ containerId: 'container-1', mediaId: 'staged-1' });
      const pollLines = logs.calls('debug').filter(([message]) => message === 'container status').map(([, fields]) => fields);
      expect(pollLines).toHaveLength(2);
      expect(pollLines[0]).toMatchObject({ containerId: 'container-1', statusCode: 'PENDING', poll: 1 });
      expect(pollLines[0]).not.toHaveProperty('status');
      expect(pollLines[1]).toMatchObject({ containerId: 'container-1', statusCode: 'FINISHED', poll: 2 });
      expect(logs.find('info', 'container ready')).toMatchObject({ containerId: 'container-1', polls: 2 });
      expect(logs.find('info', 'media_publish sent')).toMatchObject({ containerId: 'container-1' });
      expect(logs.find('info', 'media_publish accepted')).toMatchObject({ containerId: 'container-1', remoteId: 'remote-9' });
      expect(logs.find('info', 'publish done')).toMatchObject({ publicationId: 'publication-remote-9', status: 'published', remoteId: 'remote-9' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('gives every line of one publication the same correlation id', async () => {
    const logs = capture();
    try {
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('content_publishing_limit')) return jsonResponse({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
        if (url.includes('/media_publish')) return jsonResponse({ id: 'remote-9' });
        if (init?.method === 'POST') return jsonResponse({ id: 'container-1' });
        return jsonResponse({ status_code: 'FINISHED' });
      });
      const gateway = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });

      await publisherWith(gateway).execute(photo);
      // Otra publicación no puede compartir el identificador de la anterior.
      await publisherWith().execute(photo);

      const ids = logs.all().map(([, fields]) => fields.correlationId).filter((value): value is string => typeof value === 'string');
      const ofFirstRun = ids.slice(0, 8);
      expect(ofFirstRun).toHaveLength(8);
      expect(new Set(ofFirstRun).size).toBe(1);
      expect(ofFirstRun[0]).toMatch(/^publish-[0-9a-f-]{36}$/);
      expect(new Set(ids).size).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('logs retries in warn with the same correlation id', async () => {
    const logs = capture();
    try {
      const gateway = new MemoryGateway(account);
      gateway.nextError = new PublicationError('rate limit', { code: 'RATE_LIMIT', subcode: 9007, retryable: true });
      const publisher = new PublishMedia(gateway, new MemoryStaging(), new MemoryAccountResolver(account), new MemoryLog(), { logger: appLogger, maxAttempts: 2, sleep: async () => undefined });
      await publisher.execute(photo);

      const retry = logs.find('warn', 'publish retry');
      expect(retry).toMatchObject({ attempt: 1, maxAttempts: 2, code: 'RATE_LIMIT', subcode: 9007, retryable: true });
      expect(retry?.correlationId).toBe(logs.find('info', 'publish done')?.correlationId);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('writes the failed phase in error with code, subcode, retryable and message', async () => {
    const logs = capture();
    try {
      const failingResolver: AccountResolverPort = { resolve: async () => { throw new PublicationError('No usable .env file found', { code: 'AUTHENTICATION', retryable: false }); } };
      await expect(publisherWith(new MemoryGateway(account), new MemoryStaging(), failingResolver).execute(photo)).rejects.toMatchObject({ code: 'AUTHENTICATION' });
      expect(logs.calls('error').at(-1)?.[1]).toMatchObject({ phase: 'resolve', code: 'AUTHENTICATION', retryable: false, message: 'No usable .env file found' });

      await expect(publisherWith().execute({ ...photo, media: [{ path: '/tmp/a.jpg' }, { path: '/tmp/b.jpg' }] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(logs.calls('error').at(-1)?.[1]).toMatchObject({ phase: 'validate', code: 'INVALID_REQUEST', retryable: false });

      const exhausted = new MemoryGateway(account);
      exhausted.quota = { quotaUsage: 25, quotaTotal: 25, quotaRemaining: 0 };
      await expect(publisherWith(exhausted).execute(photo)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
      expect(logs.calls('error').at(-1)?.[1]).toMatchObject({ phase: 'quota', code: 'QUOTA_EXHAUSTED', retryable: false });

      const failingStaging = new MemoryStaging();
      failingStaging.fail = true;
      await expect(publisherWith(new MemoryGateway(account), failingStaging).execute(photo)).rejects.toMatchObject({ code: 'STAGING_FAILURE' });
      expect(logs.calls('error').at(-1)?.[1]).toMatchObject({ phase: 'staging', code: 'STAGING_FAILURE', retryable: false });

      const failingGateway = new MemoryGateway(account);
      failingGateway.nextError = new PublicationError(
        'Instagram media container failed with ERROR (subcode 2207026: unsupported video format; upload an MOV or MP4)',
        { code: 'INVALID_REQUEST', subcode: 2207026, retryable: false },
      );
      await expect(publisherWith(failingGateway).execute({ ...photo, type: 'reel', media: [{ path: '/tmp/reel.mp4' }] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const last = logs.calls('error').at(-1)?.[1];
      expect(last).toMatchObject({ phase: 'publish', code: 'INVALID_REQUEST', subcode: 2207026, retryable: false });
      expect(String(last?.message)).toContain('subcode 2207026');
      // Un fallo deja una sola línea de error, con la fase incluida.
      expect(logs.calls('error')).toHaveLength(5);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
