import { DEFAULT_AUDIO_LIMIT, MAX_AUDIO_LIMIT, isAudioType, type AudioTrack } from '../domain/Audio.js';
import { invalidRequestError } from '../domain/PublicationError.js';
import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

/** Busca audio (música de Meta o sonidos originales de reels) para adjuntarlo a un reel. Solo lectura. */
export class SearchAudio {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, audioType = 'music', searchQuery?: string, limit?: number, envFile?: string): Promise<readonly AudioTrack[]> {
    if (!isAudioType(audioType)) throw invalidRequestError('audio_type must be music or original_sound');
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIO_LIMIT)) {
      throw invalidRequestError(`limit must be an integer between 1 and ${MAX_AUDIO_LIMIT}`);
    }
    const query = searchQuery?.trim();
    const account = await this.resolver.resolve(projectPath, envFile);
    // Sin `search_query` Meta devuelve lo que está de moda.
    return this.gateway.searchAudio(account, audioType, query ? query : undefined, limit ?? DEFAULT_AUDIO_LIMIT);
  }
}
