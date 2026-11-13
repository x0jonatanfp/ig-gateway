import {
  ACTION_PARAMS,
  VALID_ACTIONS,
  actionParamList,
} from "../domain/actions.js";
import {
  ConfigurationError,
  GatewayError,
  describeGatewayError,
} from "../domain/gateway-error.js";
import type { ToolOutcome } from "../domain/ig-gateway-port.js";
import { checkAccount } from "./check-account.js";
import type { UseCaseDeps } from "./context.js";
import { discoverAccount } from "./discover-account.js";
import { getInsights } from "./get-insights.js";
import { getQuota } from "./get-quota.js";
import { listComments } from "./list-comments.js";
import { listMedia } from "./list-media.js";
import { hideComment, replyComment } from "./moderate-comment.js";
import { fail } from "./outcome.js";
import { publicationStatus } from "./publication-status.js";
import { publishPreview } from "./publish-preview.js";
import { publish } from "./publish.js";

type UseCase = (
  deps: UseCaseDeps,
  params: Record<string, unknown>,
) => Promise<ToolOutcome>;

const USE_CASES: Record<string, UseCase> = {
  check: checkAccount,
  quota: getQuota,
  media: listMedia,
  insights: getInsights,
  comments: listComments,
  discover: discoverAccount,
  publication_status: publicationStatus,
  publish_preview: publishPreview,
  publish,
  reply_comment: replyComment,
  hide_comment: hideComment,
};

/**
 * Despacha `instagram(action, params)`. En una acción que escribe, un
 * parámetro desconocido es un error y no se escribe nada; en una lectura solo
 * se avisa al final, para no romper llamadas que hoy funcionan. Los fallos se
 * traducen por código y nunca incluyen el token.
 */
export async function runInstagramAction(
  deps: UseCaseDeps,
  action: string,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const spec = ACTION_PARAMS[action];
  const useCase = USE_CASES[action];
  if (!spec || !useCase) {
    return fail(
      `Acción desconocida: '${action}'. Acciones válidas: ${VALID_ACTIONS.join(", ")}.`,
    );
  }

  const allowed = actionParamList(action);
  const unknown = Object.keys(params).filter((key) => !allowed.includes(key));
  if (spec.writes && unknown.length > 0) {
    return fail(
      `Parámetros desconocidos en ${action}: ${unknown.join(", ")}. Los de ${action} son: ${allowed.join(", ")}. No se ha escrito nada.`,
    );
  }

  try {
    const outcome = await useCase(deps, params);
    if (unknown.length === 0) return outcome;
    return {
      success: outcome.success,
      text: `${outcome.text}\nAviso: parámetros ignorados: ${unknown.join(", ")}. Los de ${action} son: ${allowed.join(", ")}.`,
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return fail(error.message);
    }
    if (error instanceof GatewayError) {
      return fail(describeGatewayError(error));
    }
    return fail(
      `Error inesperado: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
