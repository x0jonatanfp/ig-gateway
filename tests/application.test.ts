import { describe, expect, it } from 'vitest';
import { ListMedia, MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging, PublishMedia, PublishStory, SweepStaging } from '../src/application/index.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: 'account-1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'quota']) };
function setup() { const gateway = new MemoryGateway(account); const staging = new MemoryStaging(); const log = new MemoryLog(); const publisher = new PublishMedia(gateway, staging, new MemoryAccountResolver(account), log, 3, async () => undefined); return { gateway, staging, log, publisher }; }

describe('application', () => {
  it('publishes and cleans staged media', async () => { const { publisher, gateway, staging } = setup(); const result = await publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/original.jpg' }], caption: 'ok' }); expect(result.status).toBe('published'); expect(gateway.publishCalls).toBe(1); expect(staging.cleanupCalls).toBe(1); expect(staging.items).toHaveLength(0); });
  it('retries transient errors and then succeeds', async () => { const { publisher, gateway, log } = setup(); gateway.nextError = new PublicationError('retry', { code: 'RATE_LIMIT', subcode: 9007, retryable: true }); const result = await publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }] }); expect(result.status).toBe('published'); expect(gateway.publishCalls).toBe(2); expect(log.events).toHaveLength(1); });
  it('waits between retries instead of firing at once', async () => {
    const gateway = new MemoryGateway(account); const staging = new MemoryStaging(); const log = new MemoryLog(); const waits: number[] = [];
    const publisher = new PublishMedia(gateway, staging, new MemoryAccountResolver(account), log, 2, async (ms) => { waits.push(ms); });
    gateway.nextError = new PublicationError('rate limit', { code: 'RATE_LIMIT', retryable: true });
    await publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }] });
    expect(waits).toEqual([5_000]);
  });
  it('stops on definitive errors', async () => { const { publisher, gateway, staging } = setup(); gateway.nextError = new PublicationError('bad token', { code: 'AUTHENTICATION', subcode: 190, retryable: false }); await expect(publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }] })).rejects.toMatchObject({ code: 'AUTHENTICATION', retryable: false }); expect(gateway.publishCalls).toBe(1); expect(staging.cleanupCalls).toBe(1); });
  it('rejects exhausted quota before staging', async () => { const { publisher, gateway, staging } = setup(); gateway.quota = { quotaUsage: 25, quotaTotal: 25, quotaRemaining: 0 }; await expect(publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }] })).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' }); expect(staging.items).toHaveLength(0); expect(staging.cleanupCalls).toBe(0); });
  it('does not call Meta if staging fails', async () => { const { publisher, gateway, staging } = setup(); staging.fail = true; await expect(publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }] })).rejects.toMatchObject({ code: 'STAGING_FAILURE' }); expect(gateway.publishCalls).toBe(0); });
  it('is idempotent by key', async () => { const { publisher, gateway } = setup(); const first = await publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/a.jpg' }], idempotencyKey: 'same' }); const second = await publisher.execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/other.jpg' }], idempotencyKey: 'same' }); expect(second.id).toBe(first.id); expect(gateway.publishCalls).toBe(1); });
  it('publishes stories through the story use case', async () => { const { gateway, staging, log } = setup(); const result = await new PublishStory(gateway, staging, new MemoryAccountResolver(account), log).execute({ projectPath: '/tmp/project', media: [{ path: '/tmp/story.jpg' }] }); expect(result.type).toBe('story'); });
  it('sweeps staging', async () => { const { staging } = setup(); await staging.stage([{ path: '/tmp/a.jpg' }]); expect(await new SweepStaging(staging).execute(0)).toBe(1); });
  it('lists published media resolving the project account', async () => {
    const { gateway } = setup();
    gateway.media = [{ id: '1', permalink: 'https://www.instagram.com/p/aaa/', caption: 'foto' }];
    const items = await new ListMedia(gateway, new MemoryAccountResolver(account)).execute('/tmp/project');
    expect(items).toHaveLength(1);
    expect(items[0]?.permalink).toBe('https://www.instagram.com/p/aaa/');
  });
});
