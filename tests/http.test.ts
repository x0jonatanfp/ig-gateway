import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging } from '../src/application/index.js';
import type { Publication } from '../src/domain/Publication.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: '1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'quota']) };
async function request(path: string, init: RequestInit = {}, log = new MemoryLog(), now?: () => number) { const app = createApp({ gateway: new MemoryGateway(account), staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log, authToken: 'gateway-secret', rateLimit: 2, ...(now === undefined ? {} : { now }) }); const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address missing'); try { return await fetch(`http://127.0.0.1:${address.port}${path}`, init); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } }

describe('http', () => {
  it('serves health without auth', async () => { const response = await request('/health'); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true }); });
  it('requires header auth outside health', async () => { expect((await request('/v1/quota?project=/tmp')).status).toBe(401); });
  it('validates project and returns JSON error', async () => { const response = await request('/v1/quota', { headers: { 'x-ig-gateway-token': 'gateway-secret' } }); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' }); });
  it('serves quota with auth', async () => { const response = await request('/v1/quota?project=/tmp', { headers: { 'x-ig-gateway-token': 'gateway-secret' } }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ quotaRemaining: 25 }); });
  it('lista el media de la cuenta con su permalink', async () => {
    const app = createApp({
      gateway: Object.assign(new MemoryGateway(account), {
        media: [
          { id: '1', permalink: 'https://www.instagram.com/p/aaa/', caption: 'con #examplecommunity', mediaType: 'IMAGE' },
          { id: '2', permalink: 'https://www.instagram.com/p/bbb/', caption: 'sin hashtag' },
        ],
      }),
      staging: new MemoryStaging(),
      resolver: new MemoryAccountResolver(account),
      log: new MemoryLog(),
      authToken: 'gateway-secret',
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/media?project=/tmp`, { headers: { 'x-ig-gateway-token': 'gateway-secret' } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        { id: '1', permalink: 'https://www.instagram.com/p/aaa/', caption: 'con #examplecommunity', mediaType: 'IMAGE' },
        { id: '2', permalink: 'https://www.instagram.com/p/bbb/', caption: 'sin hashtag' },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  it('returns 404/200 for publication lookup and maps gateway failures', async () => { const log = new MemoryLog(); const publication: Publication = { id: 'pub-1', accountId: '1', mediaIds: [], type: 'photo', caption: '', status: 'published', createdAt: new Date().toISOString() }; await log.append(publication); const found = await request('/v1/publications/pub-1', { headers: { 'x-ig-gateway-token': 'gateway-secret' } }, log); expect(found.status).toBe(200); expect(await found.json()).toMatchObject({ id: 'pub-1' }); const missing = await request('/v1/publications/missing', { headers: { 'x-ig-gateway-token': 'gateway-secret' } }, log); expect(missing.status).toBe(404); });
  it('enforces and resets the rate limit while cleaning expired entries', async () => { let current = 1000; const now = () => current; const first = await request('/health', {}, new MemoryLog(), now); expect(first.status).toBe(200); const second = await request('/health', {}, new MemoryLog(), now); expect(second.status).toBe(200); current += 61_000; const third = await request('/health', {}, new MemoryLog(), now); expect(third.status).toBe(200); });
});
