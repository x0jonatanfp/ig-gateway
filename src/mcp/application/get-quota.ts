import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { formatSeconds } from "./fields.js";
import { ok } from "./outcome.js";

/** Cuota de publicación: 100 piezas por 24 h en las cuentas del gateway. */
export async function getQuota(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const quota = await deps.gateway.getQuota(resolved.project);
  const period =
    quota.quotaDuration === undefined
      ? ""
      : ` · periodo ${formatSeconds(quota.quotaDuration)}`;
  return ok(
    `Cuota de publicación: ${quota.quotaUsage}/${quota.quotaTotal} usada · quedan ${quota.quotaRemaining}${period}.`,
  );
}
