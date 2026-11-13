import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging } from '../src/application/index.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: '1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['insights']) };

async function request(path: string, gateway: MemoryGateway) {
  const app = createApp({
    gateway,
    staging: new MemoryStaging(),
    resolver: new MemoryAccountResolver(account),
    log: new MemoryLog(),
    authToken: 'gateway-secret',
    rateLimit: 100,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address missing');
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { 'x-ig-gateway-token': 'gateway-secret' } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('http · insights', () => {
  it('devuelve las métricas de la pieza con la cuenta del proyecto', async () => {
    const insights = [{ name: 'reach', values: [{ value: 42 }, { value: 7, endTime: '2026-11-09T08:00:00+0000' }] }];
    let seen: { accountId: string; mediaId?: string } | undefined;
    const gateway = Object.assign(new MemoryGateway(account), {
      getInsights: async (received: Account, mediaId?: string) => {
        seen = { accountId: received.id, mediaId };
        return insights;
      },
    });
    const response = await request('/v1/media/1797/insights?project=/tmp', gateway);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(insights);
    expect(seen).toEqual({ accountId: account.id, mediaId: '1797' });
  });

  it('exige project y autenticación como el resto de rutas', async () => {
    const missingProject = await request('/v1/media/1797/insights', new MemoryGateway(account));
    expect(missingProject.status).toBe(400);
    expect(await missingProject.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('sin token responde 401', async () => {
    const app = createApp({ gateway: new MemoryGateway(account), staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log: new MemoryLog(), authToken: 'gateway-secret' });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/media/1797/insights?project=/tmp`);
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
