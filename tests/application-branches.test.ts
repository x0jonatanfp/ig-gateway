import { describe, expect, it } from 'vitest';
import { MemoryAccountResolver, MemoryGateway, MemoryLog, MemoryStaging, PublishMedia } from '../src/application/index.js';
import { PublicationError } from '../src/domain/PublicationError.js';
import type { Account } from '../src/domain/Account.js';

const full: Account = { id: '1', username: 'test', accessToken: 'token', tokenFingerprint: 'hash', capabilities: new Set(['media', 'stories', 'quota', 'alt_text', 'user_tags', 'collaborators', 'location']) };
const publish = (account = full, gateway = new MemoryGateway(account), staging = new MemoryStaging(), log = new MemoryLog(), attempts = 3) => new PublishMedia(gateway, staging, new MemoryAccountResolver(account), log, { maxAttempts: attempts, sleep: async () => undefined });

it('covers every optional capability and type restriction', async () => {
  for (const [field, value] of [['altText', 'alt'], ['userTags', [{ username: 'u' }]], ['collaborators', ['u']], ['locationId', 'place']] as const) {
    const limited: Account = { ...full, capabilities: new Set(['media', 'quota']) }; const input = { projectPath: '/tmp/p', media: [{ path: '/tmp/a' }], [field]: value }; await expect(publish(limited).execute(input)).rejects.toMatchObject({ code: 'PERMISSION' });
  }
  await expect(publish().execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }], type: 'story', collaborators: ['u'] })).rejects.toMatchObject({ code: 'PERMISSION' });
  await expect(publish().execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }], collaborators: ['1', '2', '3', '4'] })).rejects.toMatchObject({ code: 'PERMISSION' });
  await expect(publish().execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }], shareToFeed: true })).rejects.toMatchObject({ code: 'PERMISSION' });
});

it('covers untyped errors and zero maxAttempts with cleanup', async () => {
  const gateway = new MemoryGateway(full); gateway.publish = async () => { throw new Error('plain'); }; const staging = new MemoryStaging(); await expect(publish(full, gateway, staging).execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }] })).rejects.toThrow('plain'); expect(staging.cleanupCalls).toBe(1);
  const zeroStaging = new MemoryStaging(); await expect(publish(full, new MemoryGateway(full), zeroStaging, new MemoryLog(), 0).execute({ projectPath: '/tmp/p', media: [{ path: '/tmp/a' }] })).rejects.toBeUndefined(); expect(zeroStaging.cleanupCalls).toBe(1);
});
