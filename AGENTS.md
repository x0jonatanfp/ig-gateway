# AGENTS.md · ig-gateway

Guía para agentes de código que trabajan en este repositorio. Qué es, cómo se instala y cómo se usa está en el `README.md`.

## Qué es

Servicio aislado que centraliza el acceso a la Instagram Graph API para otros proyectos locales. Guarda los tokens de Página, respeta la cuota de publicación y los límites de peticiones, prepara las copias de media que Instagram tiene que descargar y registra cada publicación. Quien lo llama no ve ningún token: solo dice qué cuenta usa.

## Estructura

- `deploy/`
- `src/`
- `tests/`
- `.env.example`
- `.gitignore`
- `.versionrc.json`
- `CHANGELOG.md`
- `Makefile`
- `README.es.md`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `vitest.config.ts`

## Comandos

Scripts de `package.json` (raíz):

| Comando | Ejecuta |
| --- | --- |
| `pnpm build` | `pnpm typecheck && esbuild src/cli/index.ts src/http/server.ts --bundle --platform=node --format=esm --outdir=dist --packages=external && esbuild src/mcp/index.ts --bundle --platform=node --format=esm --outfile=dist/mcp/ig-mcp.mjs --packages=external` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` |
| `pnpm test:coverage` | `vitest run --coverage` |
| `pnpm test:watch` | `vitest` |

Objetivos del `Makefile`:

- `make install`
- `make build`
- `make test`
- `make coverage`
- `make typecheck`
- `make deploy`
- `make restart`
- `make check-clean`
- `make release`

## Convenciones

- Gestor de paquetes: **pnpm** (según el lockfile).
- Tests en `tests/`.
- El despliegue versionado (unidad systemd y similares) vive en `deploy/`. Los datos de esta máquina (rutas, puertos, perfiles de secretos) no van aquí: están fuera del repo.
- Configuración por entorno: copia `.env.example` a `.env` (ignorado por git). Nunca se versionan valores reales.
- Versión y `CHANGELOG.md` los genera la release (skill `my-commits`); no se editan a mano.

## Mantenimiento

- Este fichero y el `README.md` se actualizan en el mismo cambio que los deja obsoletos.
- Aquí solo va lo que puede ser público: nada de rutas locales, puertos de la máquina, IPs, perfiles de secretos ni datos personales.
