// Lectura de parámetros con los tipos que llegan por MCP. No se confía en el
// esquema: el cliente puede mandar cualquier cosa, así que cada lector
// devuelve undefined o el tipo correcto y el caso de uso decide.
import type { UserTag } from "../domain/media-rules.js";

export function str(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

export function num(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function bool(
  params: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

export function stringList(
  params: Record<string, unknown>,
  key: string,
): string[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Etiquetas de personas: descarta entradas sin username. */
export function userTagList(
  params: Record<string, unknown>,
  key: string,
): UserTag[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  const tags: UserTag[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const username =
      typeof record.username === "string" ? record.username.trim() : "";
    if (!username) continue;
    const tag: UserTag = { username };
    if (typeof record.x === "number" && Number.isFinite(record.x)) {
      tag.x = record.x;
    }
    if (typeof record.y === "number" && Number.isFinite(record.y)) {
      tag.y = record.y;
    }
    tags.push(tag);
  }
  return tags;
}

/** Recorta para una respuesta legible, conservando las palabras completas. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Segundos → «24 h», «90 min», «45 s». */
export function formatSeconds(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** Fecha ISO de Meta (`2026-11-09T14:37:35+0000`) → `2026-11-09`. */
export function isoDay(timestamp: string | undefined): string {
  if (!timestamp) return "sin fecha";
  return timestamp.slice(0, 10);
}
