import type { MediaType } from '../domain/MediaItem.js';
import type { AccountResolverPort, InstagramGatewayPort, MediaInput, MediaStagingPort, PublicationLogPort } from '../domain/ports.js';
import { PublishMedia } from './PublishMedia.js';

export class PublishStory {
  private readonly publisher: PublishMedia;
  constructor(gateway: InstagramGatewayPort, staging: MediaStagingPort, resolver: AccountResolverPort, log: PublicationLogPort) {
    this.publisher = new PublishMedia(gateway, staging, resolver, log);
  }
  execute(input: Omit<Parameters<PublishMedia['execute']>[0], 'type'> & { media: readonly MediaInput[] }) {
    return this.publisher.execute({ ...input, type: 'story' satisfies MediaType });
  }
}
