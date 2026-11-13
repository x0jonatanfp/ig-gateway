import { isAbsolute } from "node:path";
import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import {
  type PublicationDraft,
  type PublicationType,
  isPublicationType,
  validateDraft,
} from "../domain/media-rules.js";
import { previewHash } from "../domain/preview.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { str, stringList, userTagList } from "./fields.js";
import { fail } from "./outcome.js";

export type DraftResolution =
  | {
      ok: true;
      project: string;
      draft: PublicationDraft;
      hash: string;
    }
  | { ok: false; outcome: ToolOutcome };

/**
 * Convierte los params en un borrador validado y su hash. Es el paso común de
 * `publish_preview` y `publish`: si los dos lo usan, el hash no puede diferir
 * por cómo se leyeron los parámetros.
 */
export async function resolveDraft(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<DraftResolution> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved;

  const media = stringList(params, "media");
  if (media.length === 0) {
    return {
      ok: false,
      outcome: fail("media es obligatorio: una o más rutas absolutas."),
    };
  }
  for (const path of media) {
    if (!isAbsolute(path)) {
      return {
        ok: false,
        outcome: fail(
          `Ruta de media no absoluta: ${path}. Pasa la ruta completa.`,
        ),
      };
    }
  }
  for (const path of media) {
    const kind = await deps.mediaFiles.kind(path);
    if (kind !== "file") {
      return {
        ok: false,
        outcome: fail(
          `No existe el fichero de media: ${path}. No se ha llamado al gateway.`,
        ),
      };
    }
  }

  const typeRaw = str(params, "type") || "photo";
  if (!isPublicationType(typeRaw)) {
    return {
      ok: false,
      outcome: fail(
        `type no válido: '${typeRaw}'. Valores: photo, carousel, reel, story.`,
      ),
    };
  }
  const type: PublicationType = typeRaw;
  const caption = str(params, "caption");
  const altText = str(params, "alt_text") || undefined;
  const collaborators = stringList(params, "collaborators");
  const locationId = str(params, "location_id") || undefined;
  const coverUrl = str(params, "cover_url") || undefined;
  const shareToFeed =
    typeof params.share_to_feed === "boolean"
      ? params.share_to_feed
      : undefined;
  const userTags = userTagList(params, "user_tags");

  const draft: PublicationDraft = {
    media,
    type,
    caption,
    ...(altText === undefined ? {} : { altText }),
    ...(userTags === undefined ? {} : { userTags }),
    ...(collaborators.length === 0 ? {} : { collaborators }),
    ...(locationId === undefined ? {} : { locationId }),
    ...(shareToFeed === undefined ? {} : { shareToFeed }),
    ...(coverUrl === undefined ? {} : { coverUrl }),
  };
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, outcome: fail(invalid) };

  return {
    ok: true,
    project: resolved.project,
    draft,
    hash: previewHash({ project: resolved.project, ...draft }),
  };
}
