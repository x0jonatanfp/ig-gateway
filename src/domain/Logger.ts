/** Campos estructurados de una línea de log: JSON en winston, nunca interpolados. */
export type LogFields = Record<string, unknown>;

/**
 * Puerto de log: los casos de uso registran pasos sin depender de winston ni de
 * la infraestructura. El adaptador real (`appLogger`) redacta los campos.
 */
export interface LoggerPort {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Sin salida: el caso de uso se comporta igual cuando nadie le inyecta logger. */
export const silentLogger: LoggerPort = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
