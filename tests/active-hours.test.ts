import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { summarizeActiveHours, type OnlineFollowersDay } from '../src/domain/ActiveHours.js';
import { GetActiveHours, MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging } from '../src/application/index.js';
import { GraphClient } from '../src/infrastructure/graph/GraphClient.js';
import { createApp } from '../src/http/app.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: '17841400000000000', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['insights']) };

/** Un día con el mismo recuento en todas las horas salvo las indicadas. */
function day(endTime: string, overrides: Record<number, number> = {}, base = 10): OnlineFollowersDay {
  const counts: Record<string, number> = {};
  for (let hour = 0; hour < 24; hour += 1) counts[String(hour)] = overrides[hour] ?? base;
  return { endTime, counts };
}

describe('summarizeActiveHours', () => {
  it('pasa las horas del Pacífico a la zona pedida a partir del end_time real', () => {
    // Día que acaba a medianoche del Pacífico en invierno (08:00 UTC): la hora 12
    // del Pacífico son las 20:00 UTC y las 21:00 en Madrid.
    const summary = summarizeActiveHours([day('2026-11-16T08:00:00+0000', { 12: 90 })], 'Europe/Madrid');
    expect(summary.days).toBe(1);
    expect(summary.timeZone).toBe('Europe/Madrid');
    expect(summary.peak[0]).toEqual({ hour: 21, average: 90 });
    expect(summarizeActiveHours([day('2026-11-16T08:00:00+0000', { 12: 90 })], 'UTC').peak[0]).toEqual({ hour: 20, average: 90 });
  });

  it('respeta el horario de verano: en octubre el día acaba a las 07:00 UTC', () => {
    const summary = summarizeActiveHours([day('2026-10-19T07:00:00+0000', { 12: 90 })], 'UTC');
    expect(summary.peak[0]).toEqual({ hour: 19, average: 90 });
  });

  it('hace la media por hora entre días, ignora los días vacíos y redondea a un decimal', () => {
    const summary = summarizeActiveHours([
      day('2026-11-14T08:00:00+0000', { 12: 10 }, 1),
      day('2026-11-15T08:00:00+0000', { 12: 21 }, 1),
      { endTime: '2026-11-16T08:00:00+0000', counts: {} },
    ], 'UTC');
    expect(summary.days).toBe(2);
    expect(summary.hours).toHaveLength(24);
    expect(summary.hours[20]).toEqual({ hour: 20, average: 15.5 });
    expect(summary.peak.map((entry) => entry.hour)).toEqual([20, 0, 1]);
  });

  it('usa el end_time del día anterior como inicio: el día del cambio de hora dura 25 h', () => {
    // 2026-11-01 vuelve el horario estándar en el Pacífico: ese día acaba a las
    // 08:00 UTC y el anterior a las 07:00 UTC, así que empieza a las 07:00 UTC.
    const summary = summarizeActiveHours([
      { endTime: '2026-11-01T07:00:00+0000', counts: {} },
      { endTime: '2026-11-02T08:00:00+0000', counts: { 0: 50 } },
    ], 'UTC');
    expect(summary.peak[0]).toEqual({ hour: 7, average: 50 });
  });

  it('sin datos devuelve 24 horas a cero y sin horas punta', () => {
    const summary = summarizeActiveHours([{ endTime: '2026-11-16T08:00:00+0000', counts: {} }], 'UTC');
    expect(summary.days).toBe(0);
    expect(summary.hours.every((entry) => entry.average === 0)).toBe(true);
    expect(summary.peak).toEqual([]);
  });

  it('descarta claves que no son horas y end_time que no se puede leer', () => {
    const summary = summarizeActiveHours([
      { endTime: 'no es una fecha', counts: { 3: 99 } },
      { endTime: '2026-11-16T08:00:00+0000', counts: { 24: 99, x: 99, 1: 5 } },
    ], 'UTC');
    expect(summary.days).toBe(1);
    expect(summary.peak).toEqual([{ hour: 9, average: 5 }]);
  });
});

describe('GetActiveHours', () => {
  it('resuelve la cuenta del proyecto y resume en la zona pedida', async () => {
    const gateway = Object.assign(new MemoryGateway(account), {
      getOnlineFollowers: async (received: Account) => {
        expect(received.id).toBe(account.id);
        return [day('2026-11-16T08:00:00+0000', { 12: 90 })];
      },
    });
    const summary = await new GetActiveHours(gateway, new MemoryAccountResolver(account)).execute('/proyecto', 'Europe/Madrid');
    expect(summary.peak[0]).toEqual({ hour: 21, average: 90 });
  });

  it('por defecto usa UTC', async () => {
    const gateway = Object.assign(new MemoryGateway(account), { getOnlineFollowers: async () => [day('2026-11-16T08:00:00+0000', { 12: 90 })] });
    const summary = await new GetActiveHours(gateway, new MemoryAccountResolver(account)).execute('/proyecto');
    expect(summary.timeZone).toBe('UTC');
    expect(summary.peak[0]?.hour).toBe(20);
  });

  it('una zona horaria inválida es INVALID_REQUEST y no llama a Meta', async () => {
    let called = false;
    const gateway = Object.assign(new MemoryGateway(account), { getOnlineFollowers: async () => { called = true; return []; } });
    const error = await new GetActiveHours(gateway, new MemoryAccountResolver(account)).execute('/proyecto', 'Marte/Olympus').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublicationError);
    expect(error).toMatchObject({ code: 'INVALID_REQUEST', status: 400, retryable: false });
    expect(called).toBe(false);
  });
});

describe('GraphClient · online_followers', () => {
  it('pide los últimos 29 días con period=lifetime y devuelve cada día con sus horas', async () => {
    let requested = '';
    const client = new GraphClient({
      fetcher: async (input) => {
        requested = String(input);
        return new Response(JSON.stringify({ data: [{ name: 'online_followers', period: 'lifetime', values: [
          { value: { 0: 44, 1: 49 }, end_time: '2026-10-19T07:00:00+0000' },
          { value: {}, end_time: '2026-11-16T08:00:00+0000' },
          { end_time: '2026-11-17T08:00:00+0000' },
        ] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const days = await client.getOnlineFollowers(account);
    const url = new URL(requested);
    expect(url.pathname).toMatch(/\/17841400000000000\/insights$/);
    expect(url.searchParams.get('metric')).toBe('online_followers');
    expect(url.searchParams.get('period')).toBe('lifetime');
    const since = Number(url.searchParams.get('since'));
    const until = Number(url.searchParams.get('until'));
    expect(until - since).toBe(29 * 86_400);
    expect(days).toEqual([
      { endTime: '2026-10-19T07:00:00+0000', counts: { 0: 44, 1: 49 } },
      { endTime: '2026-11-16T08:00:00+0000', counts: {} },
      { endTime: '2026-11-17T08:00:00+0000', counts: {} },
    ]);
  });

  it('sin datos devuelve una lista vacía', async () => {
    const client = new GraphClient({ fetcher: async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
    expect(await client.getOnlineFollowers(account)).toEqual([]);
  });
});

async function get(path: string, gateway: MemoryGateway) {
  const app = createApp({ gateway, staging: new MemoryStaging(), resolver: new MemoryAccountResolver(account), log: new MemoryLog(), authToken: 'gateway-secret', rateLimit: 100 });
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

describe('http · active-hours', () => {
  it('GET /v1/account/active-hours devuelve el resumen en la zona pedida', async () => {
    const gateway = Object.assign(new MemoryGateway(account), { getOnlineFollowers: async () => [day('2026-11-16T08:00:00+0000', { 12: 90 })] });
    const response = await get('/v1/account/active-hours?project=/tmp&timezone=Europe/Madrid', gateway);
    expect(response.status).toBe(200);
    const body = await response.json() as { timeZone: string; days: number; peak: Array<{ hour: number; average: number }> };
    expect(body).toMatchObject({ timeZone: 'Europe/Madrid', days: 1 });
    expect(body.peak[0]).toEqual({ hour: 21, average: 90 });
  });

  it('exige project y responde 400 a una zona inválida', async () => {
    const missing = await get('/v1/account/active-hours', new MemoryGateway(account));
    expect(missing.status).toBe(400);
    const invalid = await get('/v1/account/active-hours?project=/tmp&timezone=Marte/Olympus', new MemoryGateway(account));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
