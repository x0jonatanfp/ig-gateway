import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphClient, DEFAULT_GRAPH_VERSION, DiskMediaStaging, EnvAccountResolver, JsonlPublicationLog } from '../src/infrastructure/index.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: 'account-1', username: 'test', accessToken: 'REAL_TOKEN_MUST_NOT_LEAK', tokenFingerprint: 'fingerprint', capabilities: new Set(['media', 'quota']) };
const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fixture = async (name: string) => JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures', name), 'utf8')) as unknown;

describe('infrastructure', () => {
  it.each([
    ['error-9007.json', 503, 'RATE_LIMIT', 9007, true],
    ['error-190.json', 400, 'AUTHENTICATION', undefined, false],
    ['error-2207109.json', 400, 'INVALID_REQUEST', 2207109, false],
    ['error-2207081.json', 400, 'INVALID_REQUEST', 2207081, false],
    ['error-2207003.json', 400, 'REMOTE_FAILURE', 2207003, true],
    ['error-transient.json', 400, 'INVALID_REQUEST', undefined, true],
    ['error-scheduled-500.json', 500, 'INVALID_REQUEST', undefined, false],
  ] as const)('maps Meta fixture %s', async (name, status, code, subcode, retryable) => {
    const body = await fixture(name);
    const client = new GraphClient({ fetcher: async () => response(status, body) });
    await expect(client.getQuota(account)).rejects.toMatchObject({ code, subcode, retryable });
  });
  it('defaults to Graph API v27.0 when no version is configured', async () => {
    const previous = process.env.IG_GRAPH_VERSION; delete process.env.IG_GRAPH_VERSION;
    try {
      const urls: string[] = []; const client = new GraphClient({ fetcher: async (input) => { urls.push(String(input)); return response(200, { quota_usage: 1, config: { quota_total: 25 } }); } });
      await client.getQuota(account); expect(DEFAULT_GRAPH_VERSION).toBe('v27.0'); expect(urls[0]).toContain('https://graph.facebook.com/v27.0/account-1/content_publishing_limit');
    } finally { if (previous !== undefined) process.env.IG_GRAPH_VERSION = previous; }
  });
  it('uses graph.facebook.com, env version and never calls media_publish', async () => {
    const urls: string[] = []; const client = new GraphClient({ version: 'v26.0', fetcher: async (input) => { urls.push(String(input)); return response(200, { quota_usage: 1, config: { quota_total: 25 } }); } });
    await client.getQuota(account); expect(urls[0]).toContain('https://graph.facebook.com/v26.0/account-1/content_publishing_limit'); expect(urls.join('\n')).not.toContain('media_publish');
  });
  it('resolves accepted env aliases and does not log token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ig-gateway-resolver-')); const env = join(root, '.env'); await writeFile(env, 'IG_FB_PAGE_TOKEN=secret-value\nIG_FB_ACCOUNT_ID=123\n'); const resolved = await new EnvAccountResolver().resolve(root); expect(resolved.id).toBe('123'); expect(resolved.accessToken).toBe('secret-value'); expect(resolved.tokenFingerprint).not.toContain('secret-value');
    const logPath = join(root, 'log', 'events.jsonl'); const log = new JsonlPublicationLog(logPath); await log.appendEvent({ account: resolved.username, tokenFingerprint: resolved.tokenFingerprint }); const contents = await readFile(logPath, 'utf8'); expect(contents).not.toContain('secret-value');
  });
  it('copies, cleans and sweeps disk staging without touching original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ig-gateway-staging-')); const original = join(root, 'original.jpg'); await writeFile(original, 'original'); const staging = new DiskMediaStaging(join(root, 'media'), 'https://media.example.test/ig-media'); const [item] = await staging.stage([{ path: original }], 'project'); expect(item?.path).toBe(`https://media.example.test/ig-media/project/${item?.id}`); expect(item?.localPath).not.toBe(original); expect(await readFile(original, 'utf8')).toBe('original'); expect(await readFile(item?.localPath ?? '', 'utf8')).toBe('original'); await staging.cleanup(item ? [item] : []); expect(await readFile(item?.localPath ?? '', 'utf8').catch(() => 'missing')).toBe('missing'); const [old] = await staging.stage([{ path: original }], 'project'); if (!old?.localPath) throw new Error('missing staged item'); await utimes(old.localPath, new Date(0), new Date(0)); expect(await staging.sweep(1, Date.now())).toBe(1);
    await expect(new DiskMediaStaging(join(root, 'otro-media')).stage([{ path: original }], 'project')).rejects.toMatchObject({ code: 'STAGING_FAILURE' });
  });
  it('leaves a new project folder readable by the web server even with the unit umask 0077', async () => {
    // La unidad corre con UMask=0077: sin chmod explícito la carpeta del proyecto quedaba 700,
    // nginx respondía 403 y Meta fallaba con 2207052 o «media container failed».
    const root = await mkdtemp(join(tmpdir(), 'ig-gateway-staging-umask-')); const original = join(root, 'original.jpg'); await writeFile(original, 'original');
    const previous = process.umask(0o077);
    try {
      const [item] = await new DiskMediaStaging(join(root, 'media'), 'https://media.example.test/ig-media').stage([{ path: original }], 'nueva-cuenta');
      expect((await stat(join(root, 'media', 'nueva-cuenta'))).mode & 0o777).toBe(0o750);
      expect((await stat(item?.localPath ?? '')).mode & 0o777).toBe(0o644);
    } finally { process.umask(previous); }
  });
});
