import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { resolveProject } from "./context.js";
import type { UseCaseDeps } from "./context.js";
import { str } from "./fields.js";
import { fail, ok } from "./outcome.js";

/** Métricas de una pieza, leídas por la ruta GET /v1/media/:id/insights. */
export async function getInsights(
  deps: UseCaseDeps,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const resolved = resolveProject(params, deps.defaultProject);
  if (!resolved.ok) return resolved.outcome;
  const mediaId = str(params, "media_id");
  if (!mediaId) return fail("media_id es obligatorio.");
  const insights = await deps.gateway.getInsights(resolved.project, mediaId);
  if (insights.length === 0) {
    return ok(`La pieza ${mediaId} no devolvió métricas de insights.`);
  }
  const lines = insights.map((insight) => {
    const values = insight.values.map((entry) =>
      entry.endTime === undefined
        ? `${entry.value}`
        : `${entry.value} (${entry.endTime.slice(0, 10)})`,
    );
    return `- ${insight.name}: ${values.length === 0 ? "sin valores" : values.join(", ")}`;
  });
  return ok(`Insights de ${mediaId}:\n${lines.join("\n")}`);
}
