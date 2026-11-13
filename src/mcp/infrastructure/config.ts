export interface IgMcpConfig {
  /** Base sin barra final. Por defecto el loopback de producción. */
  gatewayUrl: string;
  /** Token del servicio; sin él, cada tool falla con un error claro. */
  token: string | undefined;
  /** Proyecto cuando la tool no recibe uno. */
  defaultProject: string | undefined;
}

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:4005";

/**
 * Configuración solo por entorno: el repo no guarda tokens ni rutas de
 * producción. Una URL mal formada se detecta al arrancar (es una errata, no un
 * estado válido); la falta de token no impide arrancar porque el servidor debe
 * responder con un error de configuración útil en vez de morir en silencio.
 */
export function loadIgMcpConfig(
  env: Record<string, string | undefined> = process.env,
): IgMcpConfig {
  const rawUrl = env.IG_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`ig-mcp: IG_GATEWAY_URL no es una URL válida (${rawUrl}).`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("ig-mcp: IG_GATEWAY_URL debe ser http o https.");
  }
  return {
    gatewayUrl: rawUrl.replace(/\/+$/, ""),
    token: env.IG_GATEWAY_TOKEN?.trim() || undefined,
    defaultProject: env.IG_DEFAULT_PROJECT?.trim() || undefined,
  };
}
