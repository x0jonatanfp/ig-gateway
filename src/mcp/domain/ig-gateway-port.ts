import type { PublicationType, UserTag } from "./media-rules.js";

// Contrato REAL de la API HTTP de ig-gateway (leído en src/http/app.ts y en
// src/infrastructure/graph/GraphClient.ts). El MCP no habla con Meta: solo
// conoce estas formas.

export interface ToolOutcome {
  success: boolean;
  text: string;
}

export interface AccountCheck {
  id: string;
  username: string;
  tokenFingerprint?: string;
  name?: string;
  accountType?: string;
  mediaCount?: number;
  followersCount?: number;
  biography?: string;
  website?: string;
  capabilities?: readonly string[];
  calls?: {
    callsLastHour: number;
    callsLastMinute: number;
    maxCallsPerMinute: number;
  };
}

export interface QuotaStatus {
  quotaUsage: number;
  quotaTotal: number;
  quotaRemaining: number;
  /** Segundos del periodo (86400 en estas cuentas). */
  quotaDuration?: number;
}

export interface MediaSummary {
  id: string;
  permalink: string;
  caption: string;
  /** IMAGE, CAROUSEL_ALBUM, VIDEO, REELS… tal cual lo da Meta. */
  mediaType?: string;
  timestamp?: string;
}

export interface PublicationRecord {
  id: string;
  accountId?: string;
  mediaIds?: readonly string[];
  type?: string;
  caption?: string;
  status?: string;
  remoteId?: string;
  recovered?: boolean;
  idempotencyKey?: string;
  createdAt?: string;
  errorCode?: string;
}

export interface DiscoveredMedia {
  id: string;
  permalink: string;
  caption: string;
  mediaType?: string;
  /** URL del CDN de Meta: caduca, hay que descargarla si se usa. */
  mediaUrl?: string;
  thumbnailUrl?: string;
  timestamp?: string;
  likeCount?: number;
  commentsCount?: number;
}

export interface DiscoveredAccount {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  media?: readonly DiscoveredMedia[];
}

export interface InsightValue {
  value: number;
  /** Fecha ISO de Meta cuando la métrica viene por días. */
  endTime?: string;
}

export interface InsightRecord {
  name: string;
  values: readonly InsightValue[];
}

/** Media de seguidores en línea por hora, en la zona pedida (GET /v1/account/active-hours). */
export interface ActiveHoursRecord {
  timeZone: string;
  days: number;
  hours: readonly { hour: number; average: number }[];
  peak: readonly { hour: number; average: number }[];
}

/** Pieza de la biblioteca de audio de Instagram (GET /v1/audio). */
export interface AudioTrackRecord {
  audioId: string;
  title?: string;
  displayArtist?: string;
  /** Cuenta del audio original; solo en original_sound. */
  username?: string;
  audioType?: string;
  durationMs?: number;
  /** Enlace de previsualización: si es la descarga de Meta, caduca. */
  previewUrl?: string;
  coverArtworkUri?: string;
}

export interface CommentRecord {
  id: string;
  text?: string;
  username?: string;
  createdAt?: string;
  hidden?: boolean;
}

export interface PublishRequestInput {
  project: string;
  media: readonly string[];
  type: PublicationType;
  caption: string;
  idempotencyKey?: string;
  dryRun: boolean;
  altText?: string;
  userTags?: readonly UserTag[];
  collaborators?: readonly string[];
  locationId?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  audioId?: string;
  audioVolume?: number;
  videoVolume?: number;
}

export interface IgGatewayPort {
  checkAccount(project: string): Promise<AccountCheck>;
  getQuota(project: string): Promise<QuotaStatus>;
  listMedia(project: string, limit?: number): Promise<readonly MediaSummary[]>;
  searchAudio(
    project: string,
    audioType: string,
    searchQuery?: string,
    limit?: number,
  ): Promise<readonly AudioTrackRecord[]>;
  getInsights(
    project: string,
    mediaId: string,
  ): Promise<readonly InsightRecord[]>;
  getActiveHours(project: string, timezone?: string): Promise<ActiveHoursRecord>;
  getPublication(id: string): Promise<PublicationRecord>;
  discoverAccount(
    project: string,
    username: string,
    limit?: number,
  ): Promise<DiscoveredAccount>;
  listComments(
    project: string,
    mediaId: string,
  ): Promise<readonly CommentRecord[]>;
  replyComment(
    project: string,
    mediaId: string,
    text: string,
  ): Promise<CommentRecord>;
  hideComment(project: string, commentId: string): Promise<CommentRecord>;
  publish(input: PublishRequestInput): Promise<PublicationRecord>;
}

/**
 * Lo mínimo que el dominio necesita saber del disco para no mandar rutas que
 * no existen. El adaptador de infrastructure/ hace el stat real.
 */
export interface MediaFileChecker {
  kind(path: string): Promise<"file" | "missing">;
}
