import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging } from '../src/application/index.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: '1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'comments', 'quota', 'alt_text', 'user_tags', 'collaborators', 'location']) };
async function call(method: string, path: string, body?: unknown) { const app = createApp({ gateway: new MemoryGateway(account), staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log: new MemoryLog(), authToken: 'secret' }); const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); try { return await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { 'x-ig-gateway-token': 'secret', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } }

describe('rutas HTTP adicionales', () => {
  it('valida media y publica story con metadatos', async () => { const invalid = await call('POST', '/v1/publications', { project: '/tmp/p', media: [] }); expect(invalid.status).toBe(400); const story = await call('POST', '/v1/publications', { project: '/tmp/p', media: [{ path: '/tmp/story.jpg' }], type: 'story', dryRun: true, userTags: [{ username: 'u' }] }); expect(story.status).toBe(201); expect(await story.json()).toMatchObject({ type: 'story' }); });
  it('devuelve comentarios y convierte errores inesperados a 500', async () => { const response = await call('GET', '/v1/media/media/comments?project=/tmp/p'); expect(response.status).toBe(200); expect(await response.json()).toEqual([]); });
});
