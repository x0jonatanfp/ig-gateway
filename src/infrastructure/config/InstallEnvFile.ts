import { fileURLToPath } from 'node:url';

/**
 * `.env` de la instalación a partir de la URL del propio módulo. El CLI se
 * empaqueta en `<install>/dist/cli/index.js` y en desarrollo vive en
 * `src/cli/index.ts`: en los dos casos subir dos niveles deja `<install>/.env`,
 * así que el CLI funciona desde cualquier directorio sin rutas absolutas
 * escritas a mano.
 */
export function installEnvFile(moduleUrl: string): string {
  return fileURLToPath(new URL('../../.env', moduleUrl));
}
