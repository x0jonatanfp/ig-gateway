import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { formatSeconds, num, shorten, str } from "./fields.js";
import { fail, ok } from "./outcome.js";

const AUDIO_TYPES = ["music", "original_sound"] as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

/**
 * Busca audio de la biblioteca de Instagram (música de Meta o sonidos originales
 * de reels). Solo lectura: devuelve los ids que luego se adjuntan al crear el
 * contenedor del reel con `audio_id`.
 */
export async function searchAudio(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const audioType = str(params, "audio_type") || "music";
  if (!(AUDIO_TYPES as readonly string[]).includes(audioType)) {
    return fail(
      `audio_type no válido: '${audioType}'. Valores: music, original_sound.`,
    );
  }
  const limit = Math.min(
    Math.max(Math.trunc(num(params, "limit") ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const searchQuery = str(params, "search_query") || undefined;
  const tracks = await deps.gateway.searchAudio(
    resolved.project,
    audioType,
    searchQuery,
    limit,
  );
  const scope = searchQuery
    ? ` con «${shorten(searchQuery, 40)}»`
    : " (lo que está de moda)";
  if (tracks.length === 0) {
    return ok(
      `Meta no ha devuelto audio ${audioType}${scope}. Prueba con otras palabras o con el otro audio_type.`,
    );
  }
  const lines = tracks.map((track) => {
    const who = track.displayArtist
      ? track.displayArtist
      : track.username
        ? `@${track.username}`
        : undefined;
    const facts = [
      who,
      track.durationMs === undefined
        ? undefined
        : formatSeconds(Math.round(track.durationMs / 1000)),
    ].filter(Boolean);
    const title = track.title ? shorten(track.title, 60) : "sin título";
    const preview = track.previewUrl ? ` · ${track.previewUrl}` : "";
    return `- ${track.audioId} · ${title}${facts.length === 0 ? "" : ` · ${facts.join(" · ")}`}${preview}`;
  });
  return ok(
    `${tracks.length} audio(s) ${audioType}${scope}:\n${lines.join("\n")}\n` +
      "Para adjuntar uno a un reel: publish_preview con type=reel y audio_id (audio_volume/video_volume 1-100 si hay que mezclar).",
  );
}
