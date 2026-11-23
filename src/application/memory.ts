import type { Account } from '../domain/Account.js';
import type { MediaItem } from '../domain/MediaItem.js';
import type { Publication } from '../domain/Publication.js';
import type { Quota } from '../domain/Quota.js';
import type { Comment, DiscoveredAccount, InstagramGatewayPort, InstagramMediaItem, MediaInput, MediaStagingPort, PublicationLogPort, PublishRequest, AccountResolverPort, Insight } from '../domain/ports.js';
import { PublicationError } from '../domain/PublicationError.js';
import type { OnlineFollowersDay } from '../domain/ActiveHours.js';
import type { AudioTrack, AudioType } from '../domain/Audio.js';

export class MemoryGateway implements InstagramGatewayPort {
  account: Account;
  quota: Quota = { quotaUsage: 0, quotaTotal: 25, quotaRemaining: 25 };
  publications: Publication[] = [];
  comments: Comment[] = [];
  insights: Insight[] = [];
  media: InstagramMediaItem[] = [];
  discovered: DiscoveredAccount | undefined;
  lastDiscovery: { username: string; limit: number | undefined } | undefined;
  nextError: Error | undefined;
  publishCalls = 0;
  callStats = { callsLastHour: 0, callsLastMinute: 0, maxCallsPerMinute: 30 };
  lastRequest: PublishRequest | undefined;

  constructor(account: Account) { this.account = account; }
  async checkAccount(): Promise<Account> { return this.account; }
  async getQuota(): Promise<Quota> { return this.quota; }
  getCallStats() { return this.callStats; }
  async publish(request: PublishRequest): Promise<Publication> {
    this.publishCalls += 1;
    this.lastRequest = request;
    if (this.nextError) { const error = this.nextError; this.nextError = undefined; throw error; }
    const publication: Publication = {
      id: `pub-${this.publications.length + 1}`, accountId: request.account.id,
      mediaIds: request.media.map((item) => item.id), type: request.type,
      caption: request.caption.value, status: request.dryRun ? 'created' : 'published', remoteId: `remote-${this.publications.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    this.publications.push(publication);
    return publication;
  }
  async publishStory(request: PublishRequest): Promise<Publication> { return this.publish(request); }
  async moderateComment(_account: Account, _mediaId: string, action: 'list' | 'reply' | 'hide' | 'unhide' | 'delete' | 'open' | 'close', value?: string): Promise<Comment | Comment[]> {
    if (action === 'list') return this.comments;
    const comment: Comment = { id: `comment-${this.comments.length + 1}`, text: value ?? '', username: 'memory', createdAt: new Date().toISOString() };
    if (action === 'hide' || action === 'unhide') comment.hidden = action === 'hide';
    if (action !== 'delete') this.comments.push(comment);
    return comment;
  }
  async getInsights(): Promise<readonly Insight[]> { return this.insights; }
  onlineFollowers: OnlineFollowersDay[] = [];
  audio: AudioTrack[] = [];
  lastAudioSearch: { audioType: AudioType; searchQuery: string | undefined; limit: number | undefined } | undefined;
  async searchAudio(_account: Account, audioType: AudioType, searchQuery?: string, limit?: number): Promise<readonly AudioTrack[]> {
    this.lastAudioSearch = { audioType, searchQuery, limit };
    return this.audio;
  }
  async getOnlineFollowers(): Promise<readonly OnlineFollowersDay[]> { return this.onlineFollowers; }
  async listMedia(): Promise<readonly InstagramMediaItem[]> { return this.media; }
  async discoverAccount(_account: Account, username: string, limit?: number): Promise<DiscoveredAccount> {
    this.lastDiscovery = { username, limit };
    if (this.nextError) { const error = this.nextError; this.nextError = undefined; throw error; }
    return this.discovered ?? { username, media: [] };
  }
}

export class MemoryStaging implements MediaStagingPort {
  items: MediaItem[] = [];
  fail = false;
  cleanupCalls = 0;
  async stage(inputs: readonly MediaInput[]): Promise<readonly MediaItem[]> {
    if (this.fail) throw new PublicationError('Staging failed', { code: 'STAGING_FAILURE', retryable: false });
    const staged = inputs.map((input, index) => ({ id: `staged-${this.items.length + index + 1}`, type: input.type ?? 'photo', path: `https://staging.test/staged-${this.items.length + index + 1}.media`, localPath: `/tmp/staged-${this.items.length + index + 1}.media`, originalPath: input.path, ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }), ...(input.altText === undefined ? {} : { altText: input.altText }), ...(input.userTags === undefined ? {} : { userTags: input.userTags }), ...(input.collaborators === undefined ? {} : { collaborators: input.collaborators }), ...(input.locationId === undefined ? {} : { locationId: input.locationId }), ...(input.shareToFeed === undefined ? {} : { shareToFeed: input.shareToFeed }), ...(input.coverUrl === undefined ? {} : { coverUrl: input.coverUrl }), ...(input.thumbOffset === undefined ? {} : { thumbOffset: input.thumbOffset }), ...(input.audioName === undefined ? {} : { audioName: input.audioName }) } satisfies MediaItem));
    this.items.push(...staged);
    return staged;
  }
  async cleanup(items: readonly MediaItem[]): Promise<void> { this.cleanupCalls += 1; this.items = this.items.filter((item) => !items.some((candidate) => candidate.id === item.id)); }
  async sweep(): Promise<number> { const count = this.items.length; this.items = []; return count; }
}

export class MemoryLog implements PublicationLogPort {
  publications: Publication[] = [];
  events: Record<string, unknown>[] = [];
  async find(id: string): Promise<Publication | undefined> { return this.publications.find((item) => item.id === id); }
  async findByIdempotencyKey(key: string): Promise<Publication | undefined> { return this.publications.find((item) => item.idempotencyKey === key); }
  async append(publication: Publication): Promise<void> { this.publications.push(publication); }
  async appendEvent(event: Record<string, unknown>): Promise<void> { this.events.push(event); }
}

export class MemoryAccountResolver implements AccountResolverPort {
  constructor(private readonly account: Account) {}
  async resolve(): Promise<Account> { return this.account; }
}
