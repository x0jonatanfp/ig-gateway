import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { previewIdFrom } from "../domain/preview.js";
import type { UseCaseDeps } from "./context.js";
import { resolveDraft } from "./draft.js";
import { fail, ok } from "./outcome.js";

/**
 * Escritura en seco: pide al gateway `dryRun: true` (no crea contenedores ni
 * publica) y guarda la huella para que `publish` pueda exigir este mismo
 * contenido. Devuelve el id de la prueba y un resumen de lo que se publicaría.
 */
export async function publishPreview(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = await resolveDraft(deps, params);
  if (!resolved.ok) return resolved.outcome;
  const publication = await deps.gateway.publish({
    project: resolved.project,
    ...resolved.draft,
    dryRun: true,
  });
  if (!publication.id) {
    return fail("El gateway no devolvió id para la vista previa.");
  }
  const previewId = previewIdFrom(resolved.hash);
  deps.previews.remember({
    id: previewId,
    hash: resolved.hash,
    createdAt: Date.now(),
    summary: `${resolved.draft.type}, ${resolved.draft.media.length} pieza(s), ${resolved.draft.caption.length} caracteres`,
  });
  const lines = [
    `Vista previa ${previewId} creada (prueba del gateway: ${publication.id}, estado ${publication.status ?? "created"}).`,
    `Tipo ${resolved.draft.type} · ${resolved.draft.media.length} pieza${resolved.draft.media.length === 1 ? "" : "s"} · caption ${resolved.draft.caption.length} caracteres.`,
  ];
  if (resolved.draft.caption) {
    lines.push(
      `Caption: «${resolved.draft.caption.slice(0, 120)}${resolved.draft.caption.length > 120 ? "…" : ""}»`,
    );
  }
  lines.push(
    `No se ha publicado nada. Para publicar: action=publish con preview_id=${previewId}, el MISMO contenido y confirm=true.`,
  );
  return ok(lines.join("\n"));
}
