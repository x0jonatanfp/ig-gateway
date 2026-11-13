import {
  ConfigurationError,
  GatewayError,
  type GatewayErrorCode,
} from "../domain/gateway-error.js";
import type {
  AccountCheck,
  CommentRecord,
  DiscoveredAccount,
  IgGatewayPort,
  InsightRecord,
  MediaSummary,
  PublicationRecord,
  PublishRequestInput,
  QuotaStatus,
} from "../domain/ig-gateway-port.js";
import type { IgMcpConfig } from "./config.js";

const KNOWN_CODES: readonly GatewayErrorCode[] = [
  "AUTHENTICATION",
  "PERMISSION",
  "RATE_LIMIT",
  "INVALID_REQUEST",
  "REMOTE_FAILURE",
  "NOT_FOUND",
  "QUOTA_EXHAUSTED",
  "STAGING_FAILURE",
  "UNKNOWN",
];

/** Publicar un reel puede tardar minutos (sondeo del contenedor). */
const DEFAULT_TIMEOUT_MS = 60_000;
const PUBLISH_TIMEOUT_MS = 420_000;

export interface HttpIgGatewayOptions {
  /** Inyectable para los tests: fake HTTP sin red. */
  fetchImpl?: typeof fetch;
}

function errorCodeFromStatus(status: number): GatewayErrorCode {
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) return "PERMISSION";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "REMOTE_FAILURE";
  return "INVALID_REQUEST";
}

function retryableFromStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Traduce el cuerpo de error del gateway (o el status si no trae `code`) a un
 * GatewayError. No se copia ninguna cabecera: el token no puede acabar en un
 * mensaje.
 */
function gatewayErrorFrom(status: number, body: unknown): GatewayError {
  const record =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const rawCode = typeof record.code === "string" ? record.code : "";
  const code = (KNOWN_CODES as readonly string[]).includes(rawCode)
    ? (rawCode as GatewayErrorCode)
    : errorCodeFromStatus(status);
  const message =
    typeof record.error === "string" && record.error.trim()
      ? record.error
      : status === 401
        ? "token del gateway rechazado (HTTP 401)"
        : `HTTP ${status}`;
  const retryable =
    typeof record.retryable === "boolean"
      ? record.retryable
      : retryableFromStatus(status);
  const subcode =
    typeof record.subcode === "number" ? record.subcode : undefined;
  return new GatewayError(message, {
    code,
    retryable,
    ...(subcode === undefined ? {} : { subcode }),
  });
}

export function createHttpIgGateway(
  config: Pick<IgMcpConfig, "gatewayUrl" | "token">,
  options: HttpIgGatewayOptions = {},
): IgGatewayPort {
  const baseUrl = config.gatewayUrl;
  const token = config.token;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!token) {
      throw new ConfigurationError(
        "Falta IG_GATEWAY_TOKEN: el gateway exige la cabecera x-ig-gateway-token. Define la variable de entorno (no se guarda en el repo). No se ha llamado al gateway.",
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "x-ig-gateway-token": token,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return Promise.reject(
          new GatewayError("tiempo de espera agotado llamando al gateway", {
            code: "REMOTE_FAILURE",
            retryable: true,
          }),
        );
      }
      return Promise.reject(
        new GatewayError(`no se pudo conectar con ${baseUrl}`, {
          code: "UNREACHABLE",
          retryable: true,
        }),
      );
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) throw gatewayErrorFrom(response.status, body);
    return body as T;
  }

  function query(
    path: string,
    values: Record<string, string | number | undefined>,
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== "") {
        search.set(key, String(value));
      }
    }
    const suffix = search.toString();
    return suffix ? `${path}?${suffix}` : path;
  }

  return {
    async checkAccount(project) {
      return request<AccountCheck>("/v1/accounts/check", {
        method: "POST",
        body: JSON.stringify({ project }),
      });
    },
    async getQuota(project) {
      return request<QuotaStatus>(query("/v1/quota", { project }));
    },
    async listMedia(project, limit) {
      return request<readonly MediaSummary[]>(
        query("/v1/media", { project, limit }),
      );
    },
    async getInsights(project, mediaId) {
      return request<readonly InsightRecord[]>(
        query(`/v1/media/${encodeURIComponent(mediaId)}/insights`, { project }),
      );
    },
    async getPublication(id) {
      return request<PublicationRecord>(
        `/v1/publications/${encodeURIComponent(id)}`,
      );
    },
    async discoverAccount(project, username, limit) {
      return request<DiscoveredAccount>(
        query(`/v1/discovery/${encodeURIComponent(username)}`, {
          project,
          limit,
        }),
      );
    },
    async listComments(project, mediaId) {
      return request<readonly CommentRecord[]>(
        query(`/v1/media/${encodeURIComponent(mediaId)}/comments`, {
          project,
        }),
      );
    },
    async replyComment(project, mediaId, text) {
      return request<CommentRecord>(
        `/v1/media/${encodeURIComponent(mediaId)}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ project, action: "reply", text }),
        },
      );
    },
    async hideComment(project, commentId) {
      return request<CommentRecord>(
        `/v1/media/${encodeURIComponent(commentId)}/comments`,
        { method: "POST", body: JSON.stringify({ project, action: "hide" }) },
      );
    },
    async publish(input: PublishRequestInput) {
      const body: Record<string, unknown> = {
        project: input.project,
        media: input.media.map((path) => ({ path })),
        caption: input.caption,
        type: input.type,
        dryRun: input.dryRun,
      };
      if (input.idempotencyKey !== undefined) {
        body.idempotencyKey = input.idempotencyKey;
      }
      if (input.altText !== undefined) body.altText = input.altText;
      if (input.userTags !== undefined) body.userTags = input.userTags;
      if (input.collaborators !== undefined) {
        body.collaborators = input.collaborators;
      }
      if (input.locationId !== undefined) body.locationId = input.locationId;
      if (input.shareToFeed !== undefined) body.shareToFeed = input.shareToFeed;
      if (input.coverUrl !== undefined) body.coverUrl = input.coverUrl;
      return request<PublicationRecord>(
        "/v1/publications",
        { method: "POST", body: JSON.stringify(body) },
        PUBLISH_TIMEOUT_MS,
      );
    },
  };
}
