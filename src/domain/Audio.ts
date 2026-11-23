import { invalidRequestError } from './PublicationError.js';

/**
 * Tipos de audio de la Audio API de Meta (changelog del 1-jun-2026): música de
 * su colección o sonido original de un reel ya publicado.
 */
export type AudioType = 'music' | 'original_sound';

/** Meta devuelve hasta 25 por página; el tope propio evita pedir de más. */
export const DEFAULT_AUDIO_LIMIT = 25;
export const MAX_AUDIO_LIMIT = 50;

/** `audio_volume` y `video_volume`: enteros de 1 a 100 (100 es el volumen completo). */
export const MIN_AUDIO_VOLUME = 1;
export const MAX_AUDIO_VOLUME = 100;

/** Pieza de la biblioteca de audio de Instagram (`GET /ig_audio`). */
export interface AudioTrack {
  audioId: string;
  title?: string;
  displayArtist?: string;
  /** Cuenta del audio original (`ig_username`); solo en `original_sound`. */
  username?: string;
  audioType?: string;
  durationMs?: number;
  /** Enlace de previsualización: si es la descarga temporal de Meta, caduca. */
  previewUrl?: string;
  coverArtworkUri?: string;
}

export function isAudioType(value: string): value is AudioType {
  return value === 'music' || value === 'original_sound';
}

export function validateAudioVolume(name: string, value: number): number {
  if (!Number.isInteger(value) || value < MIN_AUDIO_VOLUME || value > MAX_AUDIO_VOLUME) {
    throw invalidRequestError(`${name} must be an integer between ${MIN_AUDIO_VOLUME} and ${MAX_AUDIO_VOLUME}`);
  }
  return value;
}
