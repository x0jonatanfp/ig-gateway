import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { idempotencyKeyFrom } from "../domain/preview.js";
import type { UseCaseDeps } from "./context.js";
import { resolveDraft } from "./draft.js";
import { str } from "./fields.js";
import { fail, ok } from "./outcome.js";

/**
 * Publicación real. Tres guardas antes de tocar el gateway:
 * 1. `preview_id` de una vista previa hecha en ESTE proceso;
 * 2. el contenido actual debe producir el mismo hash que aquella vista previa;
 * 3. `confirm: true`.
 * La clave de idempotencia sale del hash, así que un reintento del mismo
 * contenido no duplica el post: el gateway devuelve el previo.
 */
export async function publish(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = await resolveDraft(deps, params);
  if (!resolved.ok) return resolved.outcome;

  const previewId = str(params, "preview_id");
  if (!previewId) {
    return fail(
      "publish exige preview_id: haz antes publish_preview con este contenido. No se ha publicado nada.",
    );
  }
  const record = deps.previews.get(previewId);
  if (!record) {
    return fail(
      `preview_id desconocido en este proceso: ${previewId}. Repite publish_preview (una vista previa de otra sesión no vale). No se ha publicado nada.`,
    );
  }
  if (record.hash !== resolved.hash) {
    return fail(
      `El contenido no coincide con la vista previa ${previewId}. Cambió el media, el tipo, el caption o alguna opción. Repite publish_preview con el contenido final. No se ha publicado nada.`,
    );
  }
  if (params.confirm !== true) {
    return fail(
      "publish exige confirm: true además de preview_id. No se ha publicado nada.",
    );
  }

  const idempotencyKey = idempotencyKeyFrom(resolved.hash);
  const publication = await deps.gateway.publish({
    project: resolved.project,
    ...resolved.draft,
    dryRun: false,
    idempotencyKey,
  });

  const lines = [
    `Publicado: ${publication.id} · estado ${publication.status ?? "desconocido"} · tipo ${publication.type ?? resolved.draft.type} · ${resolved.draft.media.length} pieza${resolved.draft.media.length === 1 ? "" : "s"}.`,
  ];
  if (publication.remoteId) {
    lines.push(`Id en Instagram: ${publication.remoteId}`);
  }
  if (publication.recovered) {
    lines.push(
      "Meta falló al responder pero la comprobación confirma que la pieza sí salió (recovered): no la repitas.",
    );
  }
  lines.push(`Clave de idempotencia: ${idempotencyKey}.`);
  return ok(lines.join("\n"));
}
