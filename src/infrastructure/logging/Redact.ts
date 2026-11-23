import type { LogFields } from '../../domain/Logger.js';

export const REDACTED = '[redacted]';

/**
 * Claves que nunca salen del proceso: credenciales, cabeceras, texto del pie y
 * cuerpos de petición. `message` se deja pasar porque es el motivo del fallo.
 */
const SECRET_KEY = /token|secret|password|authorization|cookie|^caption$|^body$|^headers$/i;

/**
 * Rutas de la máquina (staging, .env del proyecto, registro de cuentas): no
 * aportan nada al diagnóstico y no deben quedar en un log que se comparte.
 */
const LOCAL_PATH_KEY = /^(path|paths|localpath|originalpath|envfile|file|files|dir|directory|project|projectpath)$/i;

/** URL con query o fragmento: los enlaces firmados de Meta caducan y llevan credenciales. */
const URL_WITH_QUERY = /^(https?:\/\/[^?#]+)[?#]/i;

/** Deja la URL sin query ni fragmento; el resto del texto se mantiene tal cual. */
export function redactUrl(value: string): string {
  const withoutQuery = URL_WITH_QUERY.exec(value);
  return withoutQuery?.[1] ?? value;
}

/**
 * Redacción central de los campos que van al log. Se aplica en `appLogger`, así
 * que cualquier línea pasa por aquí aunque quien la escriba se olvide.
 */
export function redactFields(fields: LogFields = {}): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (SECRET_KEY.test(key) || LOCAL_PATH_KEY.test(key)) return [key, REDACTED];
      if (typeof value === 'string') return [key, redactUrl(value)];
      if (Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === 'string' ? redactUrl(item) : item))];
      }
      return [key, value];
    }),
  );
}
