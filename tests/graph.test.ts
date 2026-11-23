import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Caption } from '../src/domain/Caption.js';
import { GraphClient } from '../src/infrastructure/graph/GraphClient.js';
import type { Account } from '../src/domain/Account.js';
import type { PublishRequest } from '../src/domain/ports.js';

const account: Account = { id: 'account-1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'comments', 'insights', 'quota']) };
const item = (id: string, path = `https://example.test/${id}.jpg`) => ({ id, type: 'photo' as const, path });
const request = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({ account, type: 'photo', media: [item('one')], caption: Caption.create('Caption'), ...overrides });
function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function fetchSequence(responses: unknown[], statuses?: number[]) { const calls: { url: string; init?: RequestInit }[] = []; let index = 0; const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); const body = responses[Math.min(index, responses.length - 1)]; const status = statuses?.[Math.min(index, (statuses?.length ?? 1) - 1)] ?? 200; index += 1; return jsonResponse(body, status); }); return { calls, fetcher }; }
function bodyOf(call: { url?: string; init?: RequestInit }): URLSearchParams {
  if (call.init?.body instanceof URLSearchParams) return call.init.body;
  // Los GET llevan los parámetros en la query, no en el cuerpo.
  return new URL(String(call.url ?? 'https://graph.facebook.com/')).searchParams;
}

describe('GraphClient publishing', () => {
  it('publishes a photo with exact optional parameters and media_publish', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'photo-container' }, { status_code: 'FINISHED' }, { id: 'published-photo' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ altText: 'Descripción', userTags: [{ username: 'persona', x: 0.2, y: 0.3 }], collaborators: ['uno', 'dos'], locationId: 'place', dryRun: false }));
    const params = bodyOf(calls[0] ?? {}); expect(params.get('image_url')).toBe('https://example.test/one.jpg'); expect(params.get('caption')).toBe('Caption'); expect(params.get('alt_text')).toBe('Descripción'); expect(params.get('user_tags')).toBe(JSON.stringify([{ username: 'persona', x: 0.2, y: 0.3 }])); expect(params.get('collaborators')).toBe('uno,dos'); expect(params.get('location_id')).toBe('place'); expect(params.get('access_token')).toBe('token'); expect(String(calls[2]?.url)).toContain('/media_publish'); expect(calls[0]?.init?.method).toBe('POST');
  });
  it('publishes a carousel in order with children and parent caption', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'child-1' }, { id: 'child-2' }, { id: 'parent' }, { status_code: 'FINISHED' }, { id: 'published' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ type: 'carousel', media: [item('one'), item('two')], altText: 'alt', collaborators: ['one'] }));
    expect(bodyOf(calls[0] ?? {}).get('is_carousel_item')).toBe('true'); expect(bodyOf(calls[1] ?? {}).get('is_carousel_item')).toBe('true'); expect(bodyOf(calls[0] ?? {}).get('alt_text')).toBe('alt'); expect(bodyOf(calls[2] ?? {}).get('children')).toBe('child-1,child-2'); expect(bodyOf(calls[2] ?? {}).get('caption')).toBe('Caption'); expect(bodyOf(calls[2] ?? {}).get('collaborators')).toBe('one'); expect(bodyOf(calls[2] ?? {}).get('location_id')).toBeNull();
  });
  it('publishes a carousel video item as VIDEO and waits for it before the parent', async () => {
    // Caso real del 12-nov: el mp4 iba como IMAGE y el carrusel salió sin el vídeo.
    const { calls, fetcher } = fetchSequence([{ id: 'video-child' }, { status_code: 'FINISHED' }, { id: 'photo-child' }, { id: 'parent' }, { status_code: 'FINISHED' }, { id: 'published' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ type: 'carousel', media: [item('clip', 'https://example.test/clip.mp4'), item('two')], altText: 'alt' }));
    const video = bodyOf(calls[0] ?? {}); expect(video.get('alt_text')).toBeNull(); expect(bodyOf(calls[2] ?? {}).get('alt_text')).toBe('alt'); expect(video.get('media_type')).toBe('VIDEO'); expect(video.get('video_url')).toBe('https://example.test/clip.mp4'); expect(video.get('image_url')).toBeNull(); expect(video.get('is_carousel_item')).toBe('true');
    expect(String(calls[1]?.url)).toContain('/video-child');
    const photo = bodyOf(calls[2] ?? {}); expect(photo.get('media_type')).toBe('IMAGE'); expect(photo.get('image_url')).toBe('https://example.test/two.jpg');
    expect(bodyOf(calls[3] ?? {}).get('children')).toBe('video-child,photo-child'); expect(String(calls[5]?.url)).toContain('/media_publish');
  });
  it('detects a carousel video by mime type even without extension', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'video-child' }, { status_code: 'FINISHED' }, { id: 'photo-child' }, { id: 'parent' }, { status_code: 'FINISHED' }, { id: 'published' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ type: 'carousel', media: [{ ...item('clip', 'https://example.test/clip'), mimeType: 'video/mp4' }, item('two')] }));
    expect(bodyOf(calls[0] ?? {}).get('media_type')).toBe('VIDEO'); expect(bodyOf(calls[0] ?? {}).get('video_url')).toBe('https://example.test/clip');
  });
  it('publishes a reel with video and reel-only options', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'reel-container' }, { status_code: 'FINISHED' }, { id: 'published-reel' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ type: 'reel', media: [{ ...item('reel', 'https://example.test/reel.mp4'), coverUrl: 'https://example.test/cover.jpg', thumbOffset: 1200, audioName: 'audio' }], shareToFeed: true }));
    const params = bodyOf(calls[0] ?? {}); expect(params.get('media_type')).toBe('REELS'); expect(params.get('video_url')).toContain('reel.mp4'); expect(params.get('cover_url')).toContain('cover.jpg'); expect(params.get('thumb_offset')).toBe('1200'); expect(params.get('audio_name')).toBe('audio'); expect(params.get('share_to_feed')).toBe('true');
  });
  it('publishes a story and rejects story collaborators', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'story-container' }, { status_code: 'FINISHED' }, { id: 'published-story' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ type: 'story', userTags: [{ username: 'persona' }] })); expect(bodyOf(calls[0] ?? {}).get('media_type')).toBe('STORIES'); expect(bodyOf(calls[0] ?? {}).get('user_tags')).toContain('persona');
    await expect(client.publish(request({ type: 'story', collaborators: ['bad'] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('does not publish in dry-run mode', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'container' }]); const client = new GraphClient({ fetcher, dryRun: true }); const publication = await client.publish(request()); expect(publication.status).toBe('created'); expect(calls.some((call) => call.url.includes('media_publish'))).toBe(false);
  });
  it('rejects unsupported collaborator count', async () => { const client = new GraphClient({ fetcher: async () => jsonResponse({ id: 'unused' }) }); await expect(client.publish(request({ collaborators: ['1', '2', '3', '4'] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); });
  it('rejects missing container, parent and published ids', async () => {
    const missingContainer = new GraphClient({ fetcher: fetchSequence([{}]).fetcher, sleep: async () => undefined }); await expect(missingContainer.publish(request())).rejects.toMatchObject({ code: 'REMOTE_FAILURE' });
    const missingParent = new GraphClient({ fetcher: fetchSequence([{ id: 'child' }, {}]).fetcher, sleep: async () => undefined }); await expect(missingParent.publish(request({ type: 'carousel', media: [item('a'), item('b')] }))).rejects.toMatchObject({ code: 'REMOTE_FAILURE' });
    const missingPublished = new GraphClient({ fetcher: fetchSequence([{ id: 'container' }, { status_code: 'FINISHED' }, {}]).fetcher, pollIntervalMs: 0, sleep: async () => undefined }); await expect(missingPublished.publish(request())).rejects.toMatchObject({ code: 'REMOTE_FAILURE' });
  });

  it('retries the Meta media download (subcode 2207003) until the container lands', async () => {
    // Caso visto en producción: Meta descarga el media de la URL pública y, con
    // la red en mal estado, la mitad de las conexiones se quedan colgadas. El
    // fallo es por conexión, así que se repite la misma imagen.
    const expired = { error: { message: 'Timeout', code: 2, error_subcode: 2207003, fbtrace_id: 'TRACE' } };
    const { calls, fetcher } = fetchSequence(
      [expired, expired, { id: 'child-1' }, { id: 'child-2' }, { id: 'parent' }, { status_code: 'FINISHED' }, { id: 'published' }],
      [400, 400, 200, 200, 200, 200, 200],
    );
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    const publication = await client.publish(request({ type: 'carousel', media: [item('one'), item('two')] }));
    expect(publication.status).toBe('published');
    // Solo los contenedores de imagen: el padre del carrusel no lleva image_url.
    const containers = calls.filter((call) => bodyOf(call).get('image_url') !== null);
    // 3 intentos de la primera imagen (2 fallos + 1 acierto) y 1 de la segunda.
    expect(containers).toHaveLength(4);
    expect(bodyOf(containers[0] ?? {}).get('image_url')).toBe('https://example.test/one.jpg');
    expect(bodyOf(containers[1] ?? {}).get('image_url')).toBe('https://example.test/one.jpg?r=2');
    expect(bodyOf(containers[2] ?? {}).get('image_url')).toBe('https://example.test/one.jpg?r=3');
    expect(bodyOf(containers[3] ?? {}).get('image_url')).toBe('https://example.test/two.jpg');
  });
  it('polls, handles container errors and times out', async () => {
    const pending = fetchSequence([{ id: 'container' }, { status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }, { id: 'published' }]); const client = new GraphClient({ fetcher: pending.fetcher, pollIntervalMs: 0, sleep: async () => undefined }); await client.publish(request()); expect(pending.calls).toHaveLength(4);
    const failed = new GraphClient({ fetcher: fetchSequence([{ id: 'container' }, { status_code: 'ERROR' }]).fetcher, pollIntervalMs: 0, sleep: async () => undefined }); await expect(failed.publish(request())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const timeout = new GraphClient({ fetcher: fetchSequence([{ id: 'container' }, { status_code: 'IN_PROGRESS' }]).fetcher, pollIntervalMs: 0, maxPollAttempts: 1, sleep: async () => undefined }); await expect(timeout.publish(request())).rejects.toMatchObject({ code: 'REMOTE_FAILURE', retryable: true });
  });

  it('says why a container ended in ERROR or EXPIRED', async () => {
    // Caso real del 23-nov: el reel falló y el mensaje solo decía «ERROR».
    const known = fetchSequence([{ id: 'container' }, { status_code: 'ERROR', status: '2207026' }]);
    await expect(
      new GraphClient({ fetcher: known.fetcher, pollIntervalMs: 0, sleep: async () => undefined })
        .publish(request({ type: 'reel', media: [item('reel', 'https://example.test/reel.mp4')] })),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      retryable: false,
      subcode: 2207026,
      message: 'Instagram media container failed with ERROR (subcode 2207026: unsupported video format; upload an MOV or MP4)',
    });
    // El subcódigo viaja en `status`, así que se pide junto al status_code.
    expect(bodyOf(known.calls[1] ?? {}).get('fields')).toBe('status_code,status');

    // Un subcódigo que Meta no documenta se muestra tal cual, sin causa inventada.
    const unknownStatus = fetchSequence([{ id: 'container' }, { status_code: 'ERROR', status: 2299999 }]);
    await expect(
      new GraphClient({ fetcher: unknownStatus.fetcher, pollIntervalMs: 0, sleep: async () => undefined }).publish(request()),
    ).rejects.toMatchObject({ subcode: 2299999, message: 'Instagram media container failed with ERROR (subcode 2299999)' });

    const noStatus = fetchSequence([{ id: 'container' }, { status_code: 'ERROR' }]);
    await expect(
      new GraphClient({ fetcher: noStatus.fetcher, pollIntervalMs: 0, sleep: async () => undefined }).publish(request()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false, message: 'Instagram media container failed with ERROR (Meta no dio detalle)' });

    const expired = fetchSequence([{ id: 'container' }, { status_code: 'EXPIRED' }]);
    await expect(
      new GraphClient({ fetcher: expired.fetcher, pollIntervalMs: 0, sleep: async () => undefined }).publish(request()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false, message: 'Instagram media container failed with EXPIRED (Meta no dio detalle)' });
  });

  it('caches the quota instead of asking on every publication', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => { calls += 1; return jsonResponse({ data: [{ quota_usage: 2, config: { quota_total: 100, quota_duration: 86400 } }] }); }) as unknown as typeof fetch;
    const client = new GraphClient({ fetcher });
    expect((await client.getQuota(account)).quotaRemaining).toBe(98);
    expect((await client.getQuota(account)).quotaRemaining).toBe(98);
    expect(calls).toBe(1);
    // Con poco margen se vuelve a preguntar aunque la caché siga fresca.
    const tight = new GraphClient({ fetcher: vi.fn(async () => { calls += 1; return jsonResponse({ data: [{ quota_usage: 95, config: { quota_total: 100 } }] }); }) as unknown as typeof fetch });
    await tight.getQuota(account);
    const before = calls;
    await tight.getQuota(account);
    expect(calls).toBe(before + 1);
  });

  it('when media_publish fails but the item landed, reports it as published (checked on the account)', async () => {
    // Caso real del 12-sep: Meta publica y responde «Application request limit
    // reached» (4). Antes se reintentaba y salían 3 posts; ahora se comprueba.
    const { fetcher, calls } = fetchSequence([
      { id: 'container-1' },
      { status_code: 'FINISHED' },
      { error: { message: 'Application request limit reached', code: 4 } },
      { data: [{ id: '1789', caption: 'Caption', timestamp: new Date().toISOString() }] },
    ], [200, 200, 400, 200]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });

    await expect(client.publish(request())).resolves.toMatchObject({
      status: 'published',
      remoteId: '1789',
      recovered: true,
    });
    expect(calls.some((call) => call.url.includes('/media') && !call.url.includes('media_publish'))).toBe(true);
  });

  it('when the check says it did not land, allows a retry; otherwise it does not', async () => {
    const absent = fetchSequence([
      { id: 'container-1' },
      { status_code: 'FINISHED' },
      { error: { message: 'Application request limit reached', code: 4 } },
      { data: [{ id: '1', caption: 'otra cosa', timestamp: new Date().toISOString() }] },
    ], [200, 200, 400, 200]);
    await expect(
      new GraphClient({ fetcher: absent.fetcher, pollIntervalMs: 0, sleep: async () => undefined }).publish(request()),
    ).rejects.toMatchObject({ code: 'REMOTE_FAILURE', retryable: true });

    const cannotCheck = fetchSequence([
      { id: 'container-1' },
      { status_code: 'FINISHED' },
      { error: { message: 'Application request limit reached', code: 4 } },
      { error: { message: 'Application request limit reached', code: 4 } },
    ], [200, 200, 400, 400]);
    await expect(
      new GraphClient({ fetcher: cannotCheck.fetcher, pollIntervalMs: 0, sleep: async () => undefined }).publish(request()),
    ).rejects.toMatchObject({ code: 'UNKNOWN', retryable: false });
  });

  it('counts calls and applies a soft per-minute brake', async () => {
    const waits: number[] = [];
    let now = 1_000_000;
    const dir = await mkdtemp(join(tmpdir(), 'ig-calls-limiter-'));
    const { fetcher } = fetchSequence([{ id: '1', username: 'example_studio' }]);
    const client = new GraphClient({
      fetcher,
      maxCallsPerMinute: 2,
      now: () => now,
      callsLogPath: join(dir, 'calls.jsonl'),
      sleep: async (ms) => { waits.push(ms); now += ms; },
    });
    await client.checkAccount(account);
    await client.checkAccount(account);
    expect(waits).toEqual([]);
    expect(client.getCallStats()).toMatchObject({ callsLastMinute: 2, maxCallsPerMinute: 2 });
    // Con el tope alcanzado, la siguiente espera a que se abra la ventana.
    await client.checkAccount(account);
    expect(waits.some((ms) => ms > 0)).toBe(true);
  });

  it('shares the counter across runs (the CLI starts one process per run)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ig-calls-'));
    const callsLogPath = join(dir, 'calls.jsonl');
    const { fetcher } = fetchSequence([{ id: '1', username: 'example_studio' }]);
    const first = new GraphClient({ fetcher, callsLogPath });
    await first.checkAccount(account);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = new GraphClient({ fetcher, callsLogPath });
    expect(second.getCallStats().callsLastHour).toBe(1);
    expect(first.getCallStats().callsLastHour).toBe(1);
  });
});

describe('GraphClient queries', () => {
  it('maps permissions, rate limits, invalid requests and server errors', async () => {
    const permission = new GraphClient({ fetcher: async () => jsonResponse({ error: { code: 10, message: 'permission' } }, 500) }); await expect(permission.getQuota(account)).rejects.toMatchObject({ code: 'PERMISSION', retryable: false });
    for (const body of [{ error: { code: 4, message: 'rate' } }, { error: { code: 1, message: 'server' } }]) { const client = new GraphClient({ fetcher: async () => jsonResponse(body, 500) }); await expect(client.getQuota(account)).rejects.toMatchObject({ retryable: true }); }
    const invalid = new GraphClient({ fetcher: async () => jsonResponse({ error: { code: 100, message: 'bad' } }, 400) }); await expect(invalid.getQuota(account)).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
  });
  it('parses quota, account and verified insights metrics', async () => {
    const quota = new GraphClient({ fetcher: async () => jsonResponse({ data: [{ quota_usage: 7, config: { quota_total: 100, quota_duration: 86400 } }] }) }); expect(await quota.getQuota(account)).toMatchObject({ quotaUsage: 7, quotaTotal: 100, quotaRemaining: 93, quotaDuration: 86400 });
    const urls: string[] = [];
    const accountClient = new GraphClient({ fetcher: async (input) => { urls.push(String(input)); return jsonResponse({ id: '1', username: 'name', name: 'Name', media_count: 2, followers_count: 3, biography: 'bio', website: 'site' }); } });
    const checked = await accountClient.checkAccount(account);
    expect(urls[0]).toContain('https://graph.facebook.com/'); expect(urls[0]).toContain('/account-1?'); expect(urls[0]).not.toContain('/me'); expect(urls[0]).not.toContain('account_type');
    expect(checked).toMatchObject({ mediaCount: 2, followersCount: 3, biography: 'bio', website: 'site' }); expect(checked.accountType).toBeUndefined();
    // Insights de cuenta: period obligatorio y totales del día (total_value) -> se normalizan a values.
    let requested = ''; const insightsClient = new GraphClient({ fetcher: async (input) => { requested = String(input); return jsonResponse({ data: [{ name: 'reach', total_value: { value: 5 } }, { name: 'follower_count', values: [{ value: 8, end_time: '2026-10-28T07:00:00+0000' }] }] }); } });
    expect(await insightsClient.getInsights(account)).toEqual([{ name: 'reach', values: [{ value: 5 }] }, { name: 'follower_count', values: [{ value: 8, endTime: '2026-10-28T07:00:00+0000' }] }]);
    expect(requested).toContain('metric=reach%2Cprofile_views'); expect(requested).toContain('period=day'); expect(requested).toContain('metric_type=total_value');
    // Insights de una pieza: sin period.
    const mediaRequested = await new GraphClient({ fetcher: async (input) => { requested = String(input); return jsonResponse({ data: [] }); } }).getInsights(account, 'media'); expect(mediaRequested).toEqual([]); expect(requested).toContain('metric=comments%2Clikes%2Creach%2Cviews%2Ctotal_interactions'); expect(requested).not.toContain('period=');
  });
  // Contrato real de la API: ocultar usa hide=, abrir/cerrar usa comment_enabled=
  // y borrar un comentario es DELETE sobre el id del comentario.
  it.each([
    ['list', 'GET', '/media/comments', undefined],
    ['reply', 'POST', '/media/comments', { message: 'hello' }],
    ['hide', 'POST', '/media', { hide: 'true' }],
    ['unhide', 'POST', '/media', { hide: 'false' }],
    ['delete', 'DELETE', '/media', undefined],
    ['open', 'POST', '/media', { comment_enabled: 'true' }],
    ['close', 'POST', '/media', { comment_enabled: 'false' }],
  ] as const)('supports comment action %s', async (action, method, urlPart, expected) => {
    const { calls, fetcher } = fetchSequence([action === 'list' ? { data: [] } : { id: 'comment' }]);
    const client = new GraphClient({ fetcher });
    await client.moderateComment(account, 'media', action, 'hello');
    expect(calls[0]?.init?.method).toBe(method);
    expect(calls[0]?.url).toContain(urlPart);
    if (expected) for (const [key, value] of Object.entries(expected)) expect(bodyOf(calls[0] ?? {}).get(key)).toBe(value);
    if (action === 'hide') expect(bodyOf(calls[0] ?? {}).get('is_hidden')).toBeNull();
  });

  it('lists items with their permalink and follows pagination', async () => {
    const { calls, fetcher } = fetchSequence([
      {
        data: [
          { id: '1', permalink: 'https://www.instagram.com/p/aaa/', caption: 'con #examplecommunity', media_type: 'IMAGE', timestamp: '2026-03-01T10:00:00+0000' },
          { id: '2', permalink: 'https://www.instagram.com/p/bbb/', caption: '', media_type: 'CAROUSEL_ALBUM' },
          { id: '3', caption: 'sin permalink' },
        ],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor-1' } },
      },
      { data: [{ id: '4', permalink: 'https://www.instagram.com/p/ccc/', caption: 'otra' }] },
    ]);
    const client = new GraphClient({ fetcher });
    const items = await client.listMedia(account);
    expect(items).toEqual([
      { id: '1', permalink: 'https://www.instagram.com/p/aaa/', caption: 'con #examplecommunity', mediaType: 'IMAGE', timestamp: '2026-03-01T10:00:00+0000' },
      { id: '2', permalink: 'https://www.instagram.com/p/bbb/', caption: '', mediaType: 'CAROUSEL_ALBUM' },
      { id: '4', permalink: 'https://www.instagram.com/p/ccc/', caption: 'otra' },
    ]);
    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.url)).toContain('/account-1/media');
    expect(bodyOf(calls[0] ?? {}).get('fields')).toBe('id,permalink,caption,media_type,timestamp');
    expect(bodyOf(calls[1] ?? {}).get('after')).toBe('cursor-1');
  });

  it('honours the requested item limit', async () => {
    const { calls, fetcher } = fetchSequence([
      { data: Array.from({ length: 5 }, (_, i) => ({ id: String(i), permalink: `https://www.instagram.com/p/p${i}/` })) },
    ]);
    const client = new GraphClient({ fetcher });
    const items = await client.listMedia(account, 3);
    expect(items).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });
});
