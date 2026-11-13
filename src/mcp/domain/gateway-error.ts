export type GatewayErrorCode =
  | "AUTHENTICATION"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "INVALID_REQUEST"
  | "REMOTE_FAILURE"
  | "NOT_FOUND"
  | "QUOTA_EXHAUSTED"
  | "STAGING_FAILURE"
  | "UNKNOWN"
  | "UNREACHABLE";

export class GatewayError extends Error {
  override readonly name = "GatewayError";
  readonly code: GatewayErrorCode;
  readonly retryable: boolean;
  readonly subcode: number | undefined;

  constructor(
    message: string,
    details: {
      code: GatewayErrorCode;
      retryable: boolean;
      subcode?: number;
    },
  ) {
    super(message);
    this.code = details.code;
    this.retryable = details.retryable;
    this.subcode = details.subcode;
  }
}

/**
 * Falta configuración (token, URL, project…). No es un fallo del gateway y no
 * se reintenta: reintentar sin corregir el entorno da el mismo error.
 */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

const EXPLANATIONS: Record<GatewayErrorCode, string> = {
  AUTHENTICATION:
    "Autenticación fallida: revisa IG_ACCOUNT del proyecto, la cuenta del registro del gateway y su token de Página.",
  PERMISSION:
    "La cuenta o el token no tiene permiso para esta operación (tipo de pieza o capacidad de la cuenta).",
  RATE_LIMIT:
    "Límite de peticiones de Meta alcanzado. Se puede reintentar en unos minutos.",
  INVALID_REQUEST:
    "El gateway rechazó la petición: algún parámetro no es válido para esa operación.",
  REMOTE_FAILURE: "Fallo transitorio al hablar con Meta. Se puede reintentar.",
  NOT_FOUND: "No existe la publicación, la cuenta o el recurso pedido.",
  QUOTA_EXHAUSTED:
    "Cuota de publicación agotada (100 piezas por 24 h). Espera a que se renueve.",
  STAGING_FAILURE:
    "El gateway no pudo preparar el media (copia o URL pública). No se publicó nada.",
  UNKNOWN:
    "Error no clasificado del gateway. Mira la respuesta antes de reintentar.",
  UNREACHABLE:
    "No se pudo conectar con ig-gateway. Comprueba que el servicio está activo y que IG_GATEWAY_URL es correcta.",
};

/**
 * Traduce un fallo del gateway a texto legible en español, diciendo si es
 * reintentable. Nunca incluye la cabecera ni el token: el adaptador HTTP no
 * los pone en los mensajes de error.
 */
export function describeGatewayError(error: GatewayError): string {
  const retry = error.retryable
    ? "Se puede reintentar."
    : "No reintentar sin corregir la causa.";
  const subcode =
    error.subcode === undefined ? "" : ` (subcódigo ${error.subcode})`;
  return `Error [${error.code}]${subcode}: ${EXPLANATIONS[error.code]} ${retry}\nDetalle del gateway: ${error.message}`;
}
