import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/http/app.js';
import { DiscoverAccount, MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging } from '../src/application/index.js';
import { GraphClient } from '../src/infrastructure/index.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: 'ig-1', username: 'test', accessToken: 'PAGE_TOKEN', tokenFingerprint: 'hash', capabilities: new Set(['insights']) };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function sequence(bodies: unknown[], status = 200) {
  const calls: URL[] = [];
  let index = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => { calls.push(new URL(String(input))); const body = bodies[Math.min(index, bodies.length - 1)]; index += 1; return json(body, status); });
  return { calls, fetcher };
}
const target = (media: unknown[], after?: string) => ({
  id: 'ig-1',
  business_discovery: {
    username: 'example_brand', name: 'Example Brand', biography: 'bio', website: 'https://brand.test', profile_picture_url: 'https://cdn.test/p.jpg', followers_count: 10000, media_count: 100,
    media: { data: media, ...(after === undefined ? {} : { paging: { cursors: { after } } }) },
  },
});

describe('Business Discovery', () => {
  it('consulta graph.facebook.com con el token de Página y mapea el perfil y las piezas', async () => {
    const { calls, fetcher } = sequence([target([
      { id: '1', media_type: 'IMAGE', media_url: 'https://cdn.test/1.jpg', permalink: 'https://www.instagram.com/p/a/', timestamp: '2026-10-01T10:00:00+0000', like_count: 5, comments_count: 1, caption: 'hola' },
      { id: '2', media_type: 'VIDEO', thumbnail_url: 'https://cdn.test/2.jpg', permalink: 'https://www.instagram.com/reel/b/' },
      { id: '3', media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn.test/3.jpg', permalink: 'https://www.instagram.com/p/c/', children: { data: [{ media_type: 'IMAGE', media_url: 'https://cdn.test/3a.jpg' }] } },
      { id: 'sin-permalink' },
    ])]);
    const result = await new GraphClient({ fetcher }).discoverAccount(account, 'example_brand', 8);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.origin).toBe('https://graph.facebook.com');
    expect(calls[0]?.pathname).toContain('/ig-1');
    expect(calls[0]?.searchParams.get('fields')).toContain('business_discovery.username(example_brand){username,name,biography,website,profile_picture_url,followers_count,media_count,media.limit(8){');
    expect(result).toMatchObject({ username: 'example_brand', followersCount: 10000, mediaCount: 100, profilePictureUrl: 'https://cdn.test/p.jpg' });
    expect(result.media).toEqual([
      { id: '1', permalink: 'https://www.instagram.com/p/a/', caption: 'hola', mediaType: 'IMAGE', mediaUrl: 'https://cdn.test/1.jpg', timestamp: '2026-10-01T10:00:00+0000', likeCount: 5, commentsCount: 1 },
      { id: '2', permalink: 'https://www.instagram.com/reel/b/', caption: '', mediaType: 'VIDEO', thumbnailUrl: 'https://cdn.test/2.jpg' },
      { id: '3', permalink: 'https://www.instagram.com/p/c/', caption: '', mediaType: 'CAROUSEL_ALBUM', mediaUrl: 'https://cdn.test/3.jpg', children: [{ mediaType: 'IMAGE', mediaUrl: 'https://cdn.test/3a.jpg' }] },
    ]);
  });

  it('pagina con cursores hasta el límite pedido y no pide más', async () => {
    const page = (ids: string[], after?: string) => target(ids.map((id) => ({ id, permalink: `https://www.instagram.com/p/${id}/` })), after);
    const { calls, fetcher } = sequence([page(['1', '2'], 'cur-1'), page(['3', '4'], 'cur-2')]);
    const result = await new GraphClient({ fetcher }).discoverAccount(account, 'example_brand', 3);
    expect(result.media.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.searchParams.get('fields')).toContain('.after(cur-1)');
  });

  it('limita a 25 piezas por página y a 100 en total', async () => {
    const { calls, fetcher } = sequence([target([])]);
    await new GraphClient({ fetcher }).discoverAccount(account, 'example_brand', 500);
    expect(calls[0]?.searchParams.get('fields')).toContain('media.limit(25)');
  });

  it('traduce «Invalid user id» a cuenta no encontrada o no profesional', async () => {
    const { fetcher } = sequence([{ error: { message: 'Invalid user id', code: 110, error_subcode: 2207013, fbtrace_id: 'trace' } }], 400);
    await expect(new GraphClient({ fetcher }).discoverAccount(account, 'personal')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, subcode: 2207013, retryable: false });
  });

  it('deja pasar el error de permisos de Meta sin reinterpretarlo', async () => {
    const { fetcher } = sequence([{ error: { message: '(#10) Application does not have permission for this action', code: 10 } }], 400);
    await expect(new GraphClient({ fetcher }).discoverAccount(account, 'example_brand')).rejects.toMatchObject({ code: 'PERMISSION', retryable: false });
  });

  it('falla con NOT_FOUND si Meta no devuelve business_discovery', async () => {
    const { fetcher } = sequence([{ id: 'ig-1' }]);
    await expect(new GraphClient({ fetcher }).discoverAccount(account, 'example_brand')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DiscoverAccount', () => {
  it('quita la @, pasa el límite y usa la credencial de Facebook', async () => {
    const gateway = new MemoryGateway(account);
    const resolver = new MemoryAccountResolver(account);
    const spy = vi.spyOn(resolver, 'resolve');
    await new DiscoverAccount(gateway, resolver).execute('/tmp/project', '@example_brand', '/tmp/.env', 4);
    expect(gateway.lastDiscovery).toEqual({ username: 'example_brand', limit: 4 });
    expect(spy).toHaveBeenCalledWith('/tmp/project', '/tmp/.env', undefined);
  });

  it('pasa la cuenta del registro cuando se indica --account', async () => {
    const resolver = new MemoryAccountResolver(account);
    const spy = vi.spyOn(resolver, 'resolve');
    await new DiscoverAccount(new MemoryGateway(account), resolver).execute('', 'example_brand', undefined, undefined, 'example_studio');
    expect(spy).toHaveBeenCalledWith('', undefined, 'example_studio');
  });

  it.each(['', 'con espacios', 'a'.repeat(31), 'bad/user'])('rechaza el usuario %j', async (username) => {
    await expect(new DiscoverAccount(new MemoryGateway(account), new MemoryAccountResolver(account)).execute('/tmp', username)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rechaza un límite negativo o no entero', async () => {
    const useCase = new DiscoverAccount(new MemoryGateway(account), new MemoryAccountResolver(account));
    await expect(useCase.execute('/tmp', 'example_brand', undefined, -1)).rejects.toBeInstanceOf(PublicationError);
    await expect(useCase.execute('/tmp', 'example_brand', undefined, 1.5)).rejects.toBeInstanceOf(PublicationError);
  });
});

describe('GET /v1/discovery/:username', () => {
  it('devuelve el perfil y las piezas', async () => {
    const gateway = new MemoryGateway(account);
    gateway.discovered = { username: 'example_brand', followersCount: 10, mediaCount: 2, media: [{ id: '1', permalink: 'https://www.instagram.com/p/a/', caption: '' }] };
    const server = createServer(createApp({ gateway, staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log: new MemoryLog(), authToken: 'gateway-secret', rateLimit: 5 }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/discovery/example_brand?project=/tmp&limit=3`, { headers: { 'x-ig-gateway-token': 'gateway-secret' } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ username: 'example_brand', followersCount: 10, media: [{ id: '1' }] });
      expect(gateway.lastDiscovery).toEqual({ username: 'example_brand', limit: 3 });
      expect((await fetch(`http://127.0.0.1:${address.port}/v1/discovery/example_brand?project=/tmp`)).status).toBe(401);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
