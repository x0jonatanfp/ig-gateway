import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { ok } from "./outcome.js";

/** Cuenta resuelta + salud del gateway: es el diagnóstico previo a publicar. */
export async function checkAccount(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const account = await deps.gateway.checkAccount(resolved.project);
  const lines = [
    `Cuenta @${account.username} (id ${account.id})${account.name ? ` · ${account.name}` : ""}`,
  ];
  const counters: string[] = [];
  if (account.followersCount !== undefined) {
    counters.push(`seguidores ${account.followersCount}`);
  }
  if (account.mediaCount !== undefined) {
    counters.push(`piezas ${account.mediaCount}`);
  }
  if (counters.length > 0) lines.push(counters.join(" · "));
  if (account.website) lines.push(`Web: ${account.website}`);
  if (account.calls) {
    lines.push(
      `Llamadas a Meta: ${account.calls.callsLastHour} en la última hora, ${account.calls.callsLastMinute} en el último minuto (tope ${account.calls.maxCallsPerMinute}/min).`,
    );
  }
  return ok(lines.join("\n"));
}
