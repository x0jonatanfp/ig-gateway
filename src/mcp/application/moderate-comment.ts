import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { shorten, str } from "./fields.js";
import { fail, ok } from "./outcome.js";

function requireConfirm(
  params: Record<string, unknown>,
  action: string,
): ToolOutcome | null {
  if (params.confirm === true) return null;
  return fail(
    `${action} exige confirm: true. No se ha tocado nada en Instagram.`,
  );
}

/** Responde a un comentario. `text` es el comentario nuevo; no se inventa. */
export async function replyComment(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const denied = requireConfirm(params, "reply_comment");
  if (denied) return denied;
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const mediaId = str(params, "media_id");
  const text = str(params, "text");
  if (!mediaId) return fail("media_id es obligatorio.");
  if (!text) return fail("text es obligatorio: la respuesta que se publica.");
  const comment = await deps.gateway.replyComment(
    resolved.project,
    mediaId,
    text,
  );
  return ok(
    `Comentario publicado (id ${comment.id}) en la pieza ${mediaId}: «${shorten(text, 120)}».`,
  );
}

/** Oculta un comentario. `comment_id` es el id del comentario, no el de la pieza. */
export async function hideComment(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const denied = requireConfirm(params, "hide_comment");
  if (denied) return denied;
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const commentId = str(params, "comment_id");
  if (!commentId) return fail("comment_id es obligatorio.");
  const comment = await deps.gateway.hideComment(resolved.project, commentId);
  return ok(`Comentario ${comment.id} oculto.`);
}
