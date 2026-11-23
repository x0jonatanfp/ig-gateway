// Reglas de publicación que el gateway documenta y aplica. Se validan aquí
// para fallar antes de llamar al gateway: un dry-run también gasta cuota de
// llamadas a Meta (resolver de cuenta y cuota), así que no se manda basura.

export type PublicationType = "photo" | "carousel" | "reel" | "story";

/** Tipos que acepta `POST /v1/publications` (campo `type`). */
export const PUBLICATION_TYPES: readonly PublicationType[] = [
  "photo",
  "carousel",
  "reel",
  "story",
];

/** Límites verificados en ig-gateway (Caption.ts / MediaItem.ts). */
export const MAX_CAPTION_CHARS = 2_200;
// Instagram recortó los hashtags a 5 por post y por reel el 18-dic-2025; la
// documentación de Meta sigue diciendo 30.
export const MAX_HASHTAGS = 5;
// Pendiente de verificar contra Meta: su documentación dice 20 y otras fuentes, 3.
export const MAX_MENTIONS = 20;
export const MAX_COLLABORATORS = 3;
// Volúmenes de `audio_configuration`: enteros de 1 a 100 (100 = completo).
export const MIN_AUDIO_VOLUME = 1;
export const MAX_AUDIO_VOLUME = 100;
export const MIN_CAROUSEL_ITEMS = 2;
export const MAX_CAROUSEL_ITEMS = 10;

export interface UserTag {
  username: string;
  x?: number;
  y?: number;
}

export interface PublicationDraft {
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

export function isPublicationType(value: string): value is PublicationType {
  return (PUBLICATION_TYPES as readonly string[]).includes(value);
}

export function countHashtags(caption: string): number {
  // Mismo patrón que el gateway: solo cuentan los # precedidos de espacio o
  // inicio, para no contar un # dentro de una palabra o una URL.
  return [...caption.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)].length;
}

export function countMentions(caption: string): number {
  return [...caption.matchAll(/(?:^|\s)@([\p{L}\p{N}._]+)/gu)].length;
}

/**
 * Devuelve el primer problema del borrador, o null si es publicable. Los
 * mensajes nombran la regla concreta: quien llama puede corregir sin adivinar.
 */
export function validateDraft(draft: PublicationDraft): string | null {
  const count = draft.media.length;
  if (count === 0) {
    return "media es obligatorio: al menos una ruta absoluta.";
  }
  if (draft.type === "carousel") {
    if (count < MIN_CAROUSEL_ITEMS || count > MAX_CAROUSEL_ITEMS) {
      return `Un carrusel necesita entre ${MIN_CAROUSEL_ITEMS} y ${MAX_CAROUSEL_ITEMS} piezas (hay ${count}).`;
    }
  } else if (count !== 1) {
    return `${draft.type} necesita exactamente una pieza (hay ${count}).`;
  }
  if (draft.caption.length > MAX_CAPTION_CHARS) {
    return `El caption supera ${MAX_CAPTION_CHARS} caracteres (tiene ${draft.caption.length}).`;
  }
  const hashtags = countHashtags(draft.caption);
  if (hashtags > MAX_HASHTAGS) {
    return `El caption tiene ${hashtags} hashtags; el máximo es ${MAX_HASHTAGS}.`;
  }
  const mentions = countMentions(draft.caption);
  if (mentions > MAX_MENTIONS) {
    return `El caption tiene ${mentions} menciones; el máximo es ${MAX_MENTIONS}.`;
  }
  if (draft.collaborators && draft.collaborators.length > MAX_COLLABORATORS) {
    return `Instagram admite como máximo ${MAX_COLLABORATORS} colaboradores (hay ${draft.collaborators.length}).`;
  }
  if (draft.type === "story" && (draft.collaborators?.length ?? 0) > 0) {
    return "Una historia no admite colaboradores.";
  }
  if (draft.type === "carousel" && draft.locationId !== undefined) {
    return "Un carrusel no admite location_id.";
  }
  if (draft.shareToFeed !== undefined && draft.type !== "reel") {
    return "share_to_feed solo vale para reels.";
  }
  if (draft.audioId !== undefined && draft.type !== "reel") {
    return "audio_id solo vale para reels.";
  }
  if (
    draft.audioId === undefined &&
    (draft.audioVolume !== undefined || draft.videoVolume !== undefined)
  ) {
    return "audio_volume y video_volume exigen audio_id.";
  }
  for (const [name, value] of [
    ["audio_volume", draft.audioVolume],
    ["video_volume", draft.videoVolume],
  ] as const) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) ||
        value < MIN_AUDIO_VOLUME ||
        value > MAX_AUDIO_VOLUME)
    ) {
      return `${name} debe ser un entero entre ${MIN_AUDIO_VOLUME} y ${MAX_AUDIO_VOLUME} (hay ${value}).`;
    }
  }
  return null;
}
