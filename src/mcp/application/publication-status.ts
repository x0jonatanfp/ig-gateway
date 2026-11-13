import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import type { UseCaseDeps } from "./context.js";
import { shorten, str } from "./fields.js";
import { fail, ok } from "./outcome.js";

/** Estado de una publicación según el registro JSONL del gateway. */
export async function publicationStatus(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const id = str(params, "id");
  if (!id) return fail("id es obligatorio.");
  const publication = await deps.gateway.getPublication(id);
  const lines = [
    `Publicación ${publication.id} · estado ${publication.status ?? "desconocido"}`,
  ];
  if (publication.type) lines.push(`Tipo: ${publication.type}`);
  if (publication.remoteId)
    lines.push(`Id en Instagram: ${publication.remoteId}`);
  if (publication.recovered) {
    lines.push(
      "Meta falló al responder pero la pieza sí salió (recovered). No la repitas.",
    );
  }
  if (publication.errorCode) lines.push(`Error: ${publication.errorCode}`);
  if (publication.idempotencyKey) {
    lines.push(`Clave de idempotencia: ${publication.idempotencyKey}`);
  }
  if (publication.createdAt) lines.push(`Creada: ${publication.createdAt}`);
  if (publication.caption) {
    lines.push(`Caption: ${shorten(publication.caption, 160)}`);
  }
  return ok(lines.join("\n"));
}
