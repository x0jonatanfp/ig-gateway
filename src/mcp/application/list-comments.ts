import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { isoDay, shorten, str } from "./fields.js";
import { fail, ok } from "./outcome.js";

/** Comentarios de una pieza, con el id que hace falta para moderar. */
export async function listComments(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const mediaId = str(params, "media_id");
  if (!mediaId) return fail("media_id es obligatorio.");
  const comments = await deps.gateway.listComments(resolved.project, mediaId);
  if (comments.length === 0) {
    return ok(`La pieza ${mediaId} no tiene comentarios.`);
  }
  const lines = comments.map((comment) => {
    const hidden = comment.hidden ? " · oculto" : "";
    const author = comment.username ? `@${comment.username}` : "sin autor";
    return `- ${comment.id} · ${author} · ${isoDay(comment.createdAt)}${hidden} · ${shorten(comment.text ?? "", 120)}`;
  });
  return ok(
    `Comentarios de ${mediaId} (${comments.length}):\n${lines.join("\n")}`,
  );
}
