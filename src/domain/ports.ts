import type { Account } from './Account.js';
import type { OnlineFollowersDay } from './ActiveHours.js';
import type { AudioTrack, AudioType } from './Audio.js';
import type { Caption } from './Caption.js';
import type { MediaItem, MediaType, UserTag } from './MediaItem.js';
import type { Publication } from './Publication.js';
import type { Quota } from './Quota.js';

export interface PublishRequest {
  account: Account;
  type: MediaType;
  media: readonly MediaItem[];
  caption: Caption;
  altText?: string;
  userTags?: readonly UserTag[];
  collaborators?: readonly string[];
  locationId?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  thumbOffset?: number;
  /** Etiqueta del audio original del vídeo (`audio_name`); no elige música. */
  audioName?: string;
  /** Audio de la biblioteca de Meta que se adjunta al reel (`audio_configuration`). */
  audioId?: string;
  audioVolume?: number;
  videoVolume?: number;
  dryRun?: boolean;
  /** Id que comparten todas las líneas de log de esta publicación (lo genera el caso de uso). */
  correlationId?: string;
}

export interface Comment {
  id: string;
  text: string;
  username: string;
  createdAt: string;
  hidden?: boolean;
}

export interface Insight {
  name: string;
  values: readonly { value: number; endTime?: string }[];
}

/** Pieza publicada en la cuenta, tal y como la devuelve la Graph API. */
export interface InstagramMediaItem {
  id: string;
  /** URL canónica del post (https://www.instagram.com/p/<shortcode>/). */
  permalink: string;
  caption: string;
  /** IMAGE, CAROUSEL_ALBUM, VIDEO, REELS… (tal cual lo devuelve Meta). */
  mediaType?: string;
  timestamp?: string;
}

/** Hijo de un carrusel de una cuenta ajena. */
export interface DiscoveredMediaChild {
  mediaType?: string;
  mediaUrl?: string;
}

/**
 * Publicación de una cuenta ajena (Business Discovery). `mediaUrl` y
 * `thumbnailUrl` son URLs del CDN de Meta que caducan: quien las consume debe
 * descargarlas, no guardarlas como enlace.
 */
export interface DiscoveredMedia {
  id: string;
  permalink: string;
  caption: string;
  mediaType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  timestamp?: string;
  likeCount?: number;
  commentsCount?: number;
  children?: readonly DiscoveredMediaChild[];
}

/** Datos públicos de otra cuenta profesional de Instagram. */
export interface DiscoveredAccount {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  media: readonly DiscoveredMedia[];
}

export interface InstagramGatewayPort {
  checkAccount(account: Account): Promise<Account>;
  getQuota(account: Account): Promise<Quota>;
  publish(request: PublishRequest): Promise<Publication>;
  moderateComment(account: Account, mediaId: string, action: 'list' | 'reply' | 'hide' | 'unhide' | 'delete' | 'open' | 'close', value?: string): Promise<Comment | Comment[]>;
  publishStory(request: PublishRequest): Promise<Publication>;
  getInsights(account: Account, mediaId?: string): Promise<readonly Insight[]>;
  /** Seguidores en línea por hora de los últimos días (`online_followers`). */
  getOnlineFollowers(account: Account): Promise<readonly OnlineFollowersDay[]>;
  /** Piezas ya publicadas en la cuenta, con su permalink canónico. */
  listMedia(account: Account, limit?: number): Promise<readonly InstagramMediaItem[]>;
  /** Biblioteca de audio de Instagram para adjuntar a un reel (solo lectura). */
  searchAudio(account: Account, audioType: AudioType, searchQuery?: string, limit?: number): Promise<readonly AudioTrack[]>;
  /** Lectura pública de OTRA cuenta Business/Creator por su username (solo lectura). */
  discoverAccount(account: Account, username: string, limit?: number): Promise<DiscoveredAccount>;
  /** Diagnóstico opcional: cuántas llamadas se han hecho a Meta. */
  getCallStats?(): { callsLastHour: number; callsLastMinute: number; maxCallsPerMinute: number };
}

export interface MediaInput {
  path: string;
  mimeType?: string;
  originalPath?: string;
  type?: MediaType;
  altText?: string;
  userTags?: readonly UserTag[];
  collaborators?: readonly string[];
  locationId?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  thumbOffset?: number;
  audioName?: string;
}

export interface MediaStagingPort {
  stage(inputs: readonly MediaInput[], project?: string): Promise<readonly MediaItem[]>;
  cleanup(items: readonly MediaItem[]): Promise<void>;
  sweep(ttlMs: number, now?: number): Promise<number>;
}

export interface AccountResolverPort {
  /** `accountName` elige una cuenta del registro del gateway; con él, `projectPath` puede ir vacío. */
  resolve(projectPath: string, explicitEnvFile?: string, accountName?: string): Promise<Account>;
}

export interface PublicationLogPort {
  find(id: string): Promise<Publication | undefined>;
  findByIdempotencyKey(key: string): Promise<Publication | undefined>;
  append(publication: Publication): Promise<void>;
  appendEvent(event: Record<string, unknown>): Promise<void>;
}
