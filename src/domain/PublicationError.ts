export type PublicationErrorCode =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'REMOTE_FAILURE'
  | 'STAGING_FAILURE'
  | 'QUOTA_EXHAUSTED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface PublicationErrorDetails {
  code: PublicationErrorCode;
  subcode?: number;
  fbtrace?: string;
  retryable: boolean;
  status?: number;
  cause?: unknown;
}

export class PublicationError extends Error {
  override readonly name = 'PublicationError';
  readonly code: PublicationErrorCode;
  readonly subcode: number | undefined;
  readonly fbtrace: string | undefined;
  readonly retryable: boolean;
  readonly status: number | undefined;
  override readonly cause: unknown;

  constructor(message: string, details: PublicationErrorDetails) {
    super(message);
    this.code = details.code;
    this.subcode = details.subcode;
    this.fbtrace = details.fbtrace;
    this.retryable = details.retryable;
    this.status = details.status;
    this.cause = details.cause;
  }
}

/**
 * Entrada inválida: culpa de quien llama, nunca un fallo del gateway. Sin esto,
 * el manejador HTTP convertía un `Error` genérico en un 500 UNKNOWN y ocultaba
 * el mensaje real al cliente.
 */
export function invalidRequestError(message: string): PublicationError {
  return new PublicationError(message, { code: 'INVALID_REQUEST', retryable: false, status: 400 });
}
