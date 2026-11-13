import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { isoDay, num, shorten } from "./fields.js";
import { ok } from "./outcome.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Últimas piezas de la cuenta con su permalink canónico. */
export async function listMedia(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const limit = Math.min(
    Math.max(Math.trunc(num(params, "limit") ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const items = await deps.gateway.listMedia(resolved.project, limit);
  if (items.length === 0) {
    return ok("La cuenta no tiene publicaciones.");
  }
  const lines = items.map((item) => {
    const caption = item.caption ? ` · ${shorten(item.caption, 90)}` : "";
    return `- ${isoDay(item.timestamp)} · ${item.mediaType ?? "tipo desconocido"} · ${item.permalink}${caption}`;
  });
  return ok(
    `Últimas ${items.length} publicaciones de la cuenta:\n${lines.join("\n")}`,
  );
}
