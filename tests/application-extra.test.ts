import { describe, expect, it } from 'vitest';
import { CheckAccount, GetQuota, MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging, ModerateComment, PublishMedia, SweepStaging } from '../src/application/index.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const account: Account = { id: '1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'comments', 'quota', 'alt_text', 'user_tags', 'collaborators', 'location']) };

describe('auxiliary use cases', () => {
  it('checks account and quota with explicit env', async () => { const gateway = new MemoryGateway(account); const resolver = new MemoryAccountResolver(account); const checked = await new CheckAccount(gateway, resolver).execute('/tmp/project', '/tmp/.env'); expect(checked.account).toEqual(account); expect(checked.calls).toMatchObject({ maxCallsPerMinute: 30 }); expect(await new GetQuota(gateway, resolver).execute('/tmp/project', '/tmp/.env')).toMatchObject({ quotaRemaining: 25 }); });
  it('moderates comments', async () => { const gateway = new MemoryGateway(account); const resolver = new MemoryAccountResolver(account); const moderate = new ModerateComment(gateway, resolver); expect(await moderate.execute('/tmp/project', 'media', 'list')).toEqual([]); expect(await moderate.execute('/tmp/project', 'media', 'reply', 'texto')).toMatchObject({ text: 'texto' }); });
  it('cleans staging even when the log fails after publishing', async () => { const gateway = new MemoryGateway(account); const staging = new MemoryStaging(); const log = new MemoryLog(); log.append = async () => { throw new PublicationError('log', { code: 'REMOTE_FAILURE', retryable: false }); }; await expect(new PublishMedia(gateway, staging, new MemoryAccountResolver(account), log).execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }] })).rejects.toMatchObject({ code: 'REMOTE_FAILURE' }); expect(staging.cleanupCalls).toBe(1); });
  it('sweeps staging through its use case', async () => { const staging = new MemoryStaging(); await staging.stage([{ path: '/tmp/a' }]); expect(await new SweepStaging(staging).execute(0, Date.now())).toBe(1); });
});
