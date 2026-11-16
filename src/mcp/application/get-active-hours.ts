import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { str } from "./fields.js";
import { ok } from "./outcome.js";

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const decimal = (value: number) => String(value).replace(".", ",");

/** Horas con más seguidores en línea, leídas por la ruta GET /v1/account/active-hours. */
export async function getActiveHours(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const summary = await deps.gateway.getActiveHours(resolved.project, str(params, "timezone"));
  if (summary.days === 0) {
    return ok(
      "Meta no ha devuelto datos de seguidores en línea. La métrica solo existe en cuentas profesionales con 100 seguidores o más, y los dos últimos días suelen llegar vacíos.",
    );
  }
  const peak = summary.peak.map((entry) => `${pad(entry.hour)} (${decimal(entry.average)})`).join(", ");
  const hours = summary.hours.map((entry) => `${pad(entry.hour)}  ${decimal(entry.average)}`);
  return ok(
    `Seguidores en línea por hora: media de ${summary.days} días, zona ${summary.timeZone}.\nHoras punta: ${peak}\n${hours.join("\n")}`,
  );
}
