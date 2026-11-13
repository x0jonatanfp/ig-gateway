import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { isoDay, num, shorten, str } from "./fields.js";
import { fail, ok } from "./outcome.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

/** Datos públicos de otra cuenta Business/Creator (Business Discovery). */
export async function discoverAccount(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const rawUsername = str(params, "username").replace(/^@/, "");
  if (!rawUsername) return fail("username es obligatorio.");
  const limit = Math.min(
    Math.max(Math.trunc(num(params, "limit") ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const account = await deps.gateway.discoverAccount(
    resolved.project,
    rawUsername,
    limit,
  );
  const header = [
    `@${account.username}${account.name ? ` · ${account.name}` : ""}`,
  ];
  const counters: string[] = [];
  if (account.followersCount !== undefined) {
    counters.push(`seguidores ${account.followersCount}`);
  }
  if (account.mediaCount !== undefined) {
    counters.push(`piezas ${account.mediaCount}`);
  }
  if (counters.length > 0) header.push(counters.join(" · "));
  if (account.biography) header.push(shorten(account.biography, 160));
  if (account.website) header.push(`Web: ${account.website}`);
  const media = account.media ?? [];
  const lines = media.map((item) => {
    const facts = [
      isoDay(item.timestamp),
      item.mediaType ?? "tipo desconocido",
      item.likeCount === undefined ? undefined : `${item.likeCount} likes`,
      item.commentsCount === undefined
        ? undefined
        : `${item.commentsCount} comentarios`,
    ].filter(Boolean);
    const caption = item.caption ? ` · ${shorten(item.caption, 90)}` : "";
    return `- ${facts.join(" · ")} · ${item.permalink}${caption}`;
  });
  const sections = [header.join("\n")];
  if (lines.length > 0) {
    sections.push(`Últimas ${lines.length} piezas:\n${lines.join("\n")}`);
  } else {
    sections.push("Sin piezas públicas visibles.");
  }
  if (media.some((item) => item.mediaUrl || item.thumbnailUrl)) {
    sections.push(
      "Las mediaUrl/thumbnailUrl de Meta caducan: si las necesitas, descárgalas ahora.",
    );
  }
  return ok(sections.join("\n\n"));
}
