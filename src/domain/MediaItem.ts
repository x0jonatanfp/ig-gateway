import { invalidRequestError } from './PublicationError.js';

export type MediaType = 'photo' | 'carousel' | 'reel' | 'story';

export interface UserTag {
  username: string;
  x?: number;
  y?: number;
}

export interface MediaItem {
  id: string;
  type: MediaType;
  /** URL pública HTTPS desde la que Meta descarga el archivo. */
  path: string;
  /** Copia local en el staging del gateway (solo para limpiarla después). */
  localPath?: string;
  originalPath?: string;
  mimeType?: string;
  altText?: string;
  userTags?: readonly UserTag[];
  collaborators?: readonly string[];
  locationId?: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  thumbOffset?: number;
  audioName?: string;
}

/** La cardinalidad la elige quien llama: es un 400, no un fallo interno. */
export function validateMediaType(mediaType: MediaType, itemCount: number): void {
  if (itemCount === 0) throw invalidRequestError(`${mediaType} publication requires at least one media item`);
  if (mediaType === 'carousel' && (itemCount < 2 || itemCount > 10)) {
    throw invalidRequestError('A carousel must contain between 2 and 10 media items');
  }
  if (mediaType !== 'carousel' && itemCount !== 1) {
    throw invalidRequestError(`${mediaType} publication requires exactly one media item`);
  }
}
