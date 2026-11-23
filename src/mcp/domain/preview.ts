import { createHash } from "node:crypto";
import type { PublicationType, UserTag } from "./media-rules.js";

// Huella de una vista previa. `publish` solo publica si el contenido actual
// produce EXACTAMENTE el mismo hash que la vista previa recordada en este
// proceso: así no se cuela un caption o un media distinto entre el preview y
// la publicación real. Se incluyen todas las opciones que cambian el post
// (no solo media/type/caption), porque un alt text o unos colaboradores
// distintos también son otro post.

export interface PreviewContent {
  project: string;
  media: readonly string[];
  type: PublicationType;
  caption: string;
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

export function previewHash(content: PreviewContent): string {
  // JSON canónico: mismo orden de claves siempre, ausencias como null.
  // Los arrays conservan el orden porque en un carrusel el orden importa.
  const canonical = {
    project: content.project,
    media: [...content.media],
    type: content.type,
    caption: content.caption,
    altText: content.altText ?? null,
    userTags: content.userTags ?? null,
    collaborators: content.collaborators ?? null,
    locationId: content.locationId ?? null,
    shareToFeed: content.shareToFeed ?? null,
    coverUrl: content.coverUrl ?? null,
    audioId: content.audioId ?? null,
    audioVolume: content.audioVolume ?? null,
    videoVolume: content.videoVolume ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function previewIdFrom(hash: string): string {
  return `pv-${hash.slice(0, 16)}`;
}

/** Clave de idempotencia estable: el mismo contenido no publica dos veces. */
export function idempotencyKeyFrom(hash: string): string {
  return `ig-mcp-${hash.slice(0, 32)}`;
}
