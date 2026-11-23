import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging, PublishMedia, SearchAudio } from '../src/application/index.js';
import { Caption } from '../src/domain/Caption.js';
import { GraphClient } from '../src/infrastructure/graph/GraphClient.js';
import { createApp } from '../src/http/app.js';
import type { Account } from '../src/domain/Account.js';
import type { PublishRequest } from '../src/domain/ports.js';

const account: Account = { id: '17841400000000000', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'quota', 'alt_text']) };
const reel = { id: 'reel', type: 'reel' as const, path: 'https://example.test/reel.mp4' };
const request = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({ account, type: 'reel', media: [reel], caption: Caption.create('Caption'), ...overrides });

function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function fetchSequence(responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return jsonResponse(body);
  };
  return { calls, fetcher };
}
function paramsOf(call: { url?: string; init?: RequestInit }): URLSearchParams {
  if (call.init?.body instanceof URLSearchParams) return call.init.body;
  return new URL(String(call.url ?? 'https://graph.facebook.com/')).searchParams;
}
const publish = (gateway: MemoryGateway, staging = new MemoryStaging()) => new PublishMedia(gateway, staging, new MemoryAccountResolver(account), new MemoryLog(), 1, async () => undefined);

describe('GraphClient audio library', () => {
  it('searches with the Account IG user id and maps each track', async () => {
    const { calls, fetcher } = fetchSequence([
      {
        audio: [
          {
            audio_id: '403060247990261',
            title: 'Example Song',
            display_artist: 'Example Artist',
            duration_in_ms: 153_760,
            audio_type: 'music',
            download_url: 'https://cdn.example/audio.mp3',
            cover_artwork_thumbnail_uri: 'https://cdn.example/cover.jpg',
          },
          { title: 'sin id' },
        ],
      },
    ]);
    const tracks = await new GraphClient({ fetcher }).searchAudio(account, 'music');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toContain('/ig_audio');
    const params = url.searchParams;
    expect(params.get('audio_type')).toBe('music');
    expect(params.get('user_id')).toBe('17841400000000000');
    expect(params.get('search_query')).toBeNull();
    expect(params.get('access_token')).toBe('token');
    expect(tracks).toEqual([
      {
        audioId: '403060247990261',
        title: 'Example Song',
        displayArtist: 'Example Artist',
        audioType: 'music',
        durationMs: 153_760,
        previewUrl: 'https://cdn.example/audio.mp3',
        coverArtworkUri: 'https://cdn.example/cover.jpg',
      },
    ]);
  });

  it('sends search_query and limit, and reads the paged original-sound list', async () => {
    const { calls, fetcher } = fetchSequence([
      { audio: [{ audio_id: '42', ig_username: 'example_brand', audio_type: 'original_sound' }] },
    ]);
    const tracks = await new GraphClient({ fetcher }).searchAudio(account, 'original_sound', 'rain', 5);
    const params = paramsOf(calls[0] ?? {});
    expect(params.get('audio_type')).toBe('original_sound');
    expect(params.get('search_query')).toBe('rain');
    expect(params.get('limit')).toBe('5');
    expect(tracks).toEqual([{ audioId: '42', username: 'example_brand', audioType: 'original_sound' }]);
  });

  it('prefers the stable preview link over the temporary download url', async () => {
    const { fetcher } = fetchSequence([
      { audio: [{ audio_id: '7', download_url: 'https://cdn.example/tmp.mp3', on_platform_audio_preview_link: 'https://www.instagram.com/reels/audio/7/' }] },
    ]);
    const [track] = await new GraphClient({ fetcher }).searchAudio(account, 'music');
    expect(track?.previewUrl).toBe('https://www.instagram.com/reels/audio/7/');
  });
});

describe('SearchAudio', () => {
  it('resolves the account and defaults to trending music', async () => {
    const gateway = new MemoryGateway(account);
    gateway.audio = [{ audioId: '1', title: 'Example' }];
    const tracks = await new SearchAudio(gateway, new MemoryAccountResolver(account)).execute('/proyecto');
    expect(tracks).toHaveLength(1);
    expect(gateway.lastAudioSearch).toEqual({ audioType: 'music', searchQuery: undefined, limit: 25 });
  });

  it('trims the query and passes the audio type and limit', async () => {
    const gateway = new MemoryGateway(account);
    await new SearchAudio(gateway, new MemoryAccountResolver(account)).execute('/proyecto', 'original_sound', '  lluvia  ', 4);
    expect(gateway.lastAudioSearch).toEqual({ audioType: 'original_sound', searchQuery: 'lluvia', limit: 4 });
  });

  it.each(['musica', '', 'original'])('rejects the audio type %j without calling Meta', async (audioType) => {
    const gateway = new MemoryGateway(account);
    const error = await new SearchAudio(gateway, new MemoryAccountResolver(account)).execute('/proyecto', audioType).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    expect(gateway.lastAudioSearch).toBeUndefined();
  });

  it.each([0, 51, 1.5])('rejects the limit %j', async (limit) => {
    await expect(new SearchAudio(new MemoryGateway(account), new MemoryAccountResolver(account)).execute('/proyecto', 'music', undefined, limit)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('reel audio configuration', () => {
  it('sends audio_configuration as JSON inside the container form', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'reel-container' }, { status_code: 'FINISHED' }, { id: 'published' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ audioId: '403060247990261', audioVolume: 80, videoVolume: 40 }));
    const params = paramsOf(calls[0] ?? {});
    expect(params.get('media_type')).toBe('REELS');
    expect(JSON.parse(params.get('audio_configuration') ?? '{}')).toEqual({ audio_id: '403060247990261', audio_volume: 80, video_volume: 40 });
  });

  it('omits the volumes that were not asked for', async () => {
    const { calls, fetcher } = fetchSequence([{ id: 'reel-container' }, { status_code: 'FINISHED' }, { id: 'published' }]);
    const client = new GraphClient({ fetcher, pollIntervalMs: 0, sleep: async () => undefined });
    await client.publish(request({ audioId: '403060247990261' }));
    expect(JSON.parse(paramsOf(calls[0] ?? {}).get('audio_configuration') ?? '{}')).toEqual({ audio_id: '403060247990261' });
  });

  it('rejects audio outside reels and volumes without an audio id', async () => {
    const client = new GraphClient({ fetcher: async () => jsonResponse({ id: 'unused' }), sleep: async () => undefined });
    await expect(client.publish(request({ type: 'photo', media: [{ id: 'photo', type: 'photo', path: 'https://example.test/a.jpg' }], audioId: '1' }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.publish(request({ videoVolume: 50 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it.each([0, 101, 12.5])('rejects the volume %j', async (volume) => {
    const client = new GraphClient({ fetcher: async () => jsonResponse({ id: 'unused' }), sleep: async () => undefined });
    await expect(client.publish(request({ audioId: '1', audioVolume: volume }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('PublishMedia audio', () => {
  it('passes the audio to the reel publication', async () => {
    const gateway = new MemoryGateway(account);
    await publish(gateway).execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/reel.mp4' }], type: 'reel', audioId: '403060247990261', audioVolume: 100, videoVolume: 30 });
    expect(gateway.lastRequest).toMatchObject({ audioId: '403060247990261', audioVolume: 100, videoVolume: 30 });
  });

  it('rejects audio in a type that is not a reel', async () => {
    const staging = new MemoryStaging();
    await expect(publish(new MemoryGateway(account), staging).execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }], type: 'photo', audioId: '1' })).rejects.toMatchObject({ code: 'PERMISSION', status: 403 });
    expect(staging.items).toHaveLength(0);
  });

  it('rejects a volume out of range before staging anything', async () => {
    const staging = new MemoryStaging();
    await expect(publish(new MemoryGateway(account), staging).execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/reel.mp4' }], type: 'reel', audioId: '1', videoVolume: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    expect(staging.items).toHaveLength(0);
  });

  it('rejects a volume without an audio id', async () => {
    await expect(publish(new MemoryGateway(account)).execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/reel.mp4' }], type: 'reel', audioVolume: 50 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

async function withApp(gateway: MemoryGateway, run: (base: string) => Promise<void>): Promise<void> {
  const app = createApp({ gateway, staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log: new MemoryLog(), authToken: 'gateway-secret', rateLimit: 100 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
const headers = { 'x-ig-gateway-token': 'gateway-secret', 'content-type': 'application/json' };

describe('http audio', () => {
  it('GET /v1/audio returns the tracks and forwards the filters', async () => {
    const gateway = new MemoryGateway(account);
    gateway.audio = [{ audioId: '403060247990261', title: 'Example Song', displayArtist: 'Example Artist' }];
    await withApp(gateway, async (base) => {
      const response = await fetch(`${base}/v1/audio?project=/tmp&audio_type=music&search_query=example&limit=5`, { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{ audioId: '403060247990261', title: 'Example Song', displayArtist: 'Example Artist' }]);
    });
    expect(gateway.lastAudioSearch).toEqual({ audioType: 'music', searchQuery: 'example', limit: 5 });
  });

  it('requires project and answers 400 for an unknown audio_type', async () => {
    await withApp(new MemoryGateway(account), async (base) => {
      expect((await fetch(`${base}/v1/audio`, { headers })).status).toBe(400);
      const invalid = await fetch(`${base}/v1/audio?project=/tmp&audio_type=podcast`, { headers });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    });
  });

  it('POST /v1/publications carries audioId and the volumes to the gateway', async () => {
    const gateway = new MemoryGateway(account);
    await withApp(gateway, async (base) => {
      const response = await fetch(`${base}/v1/publications`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: '/tmp', type: 'reel', media: [{ path: '/tmp/reel.mp4' }], audioId: '403060247990261', audioVolume: 90, videoVolume: 20 }),
      });
      expect(response.status).toBe(201);
    });
    expect(gateway.lastRequest).toMatchObject({ audioId: '403060247990261', audioVolume: 90, videoVolume: 20 });
  });
});
