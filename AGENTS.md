# AGENTS.md · ig-gateway

Guía para agentes de código. Qué es, cómo se configura, cómo se registra el MCP y cómo se despliega está en `README.md` (y `README.es.md`).

## Qué es

Gateway local que publica en Instagram a través de la Graph API de Meta. Un único punto de salida para todos los proyectos: aplica la cuota, el límite de peticiones y el registro de publicaciones. Tiene tres adaptadores de entrada que comparten los mismos casos de uso: HTTP (`src/http/`), CLI (`src/cli/`) y un servidor MCP (`src/mcp/`). El MCP **no** llama a los casos de uso: es un cliente HTTP del servicio en marcha, para que la cuota y el registro estén en un solo sitio.

**Publicar es irreversible desde la API.** No hay programación, ni borradores, ni borrado. Trátalo como operación de producción.

## Arquitectura

Hexagonal en `src/`, con dependencias hacia dentro:

- `domain/`: entidades y puertos (`Account.ts`, `MediaItem.ts`, `Publication.ts`, `PublicationError.ts`, `Quota.ts`, `ActiveHours.ts`, `Caption.ts`, `ports.ts`). Lógica pura, sin E/S, sin config y sin logger.
- `application/`: casos de uso que solo hablan con puertos: `PublishMedia`, `PublishStory`, `CheckAccount`, `GetQuota`, `ListMedia`, `GetInsights`, `GetActiveHours`, `DiscoverAccount`, `ModerateComment`, `SweepStaging`. `memory.ts` es una implementación en memoria para pruebas.
- `infrastructure/`: el único sitio que toca red, disco o Meta:
  - `graph/GraphClient.ts`: cliente de la Graph API, con sondeo adaptativo y reintentos.
  - `staging/DiskMediaStaging.ts`: copias temporales de los medios.
  - `accounts/EnvAccountResolver.ts`: registro de cuentas por proyecto.
  - `logging/JsonlPublicationLog.ts` y `Logger.ts`.
  - `config/InstallEnvFile.ts`.
- `http/app.ts` y `http/server.ts`: rutas Express (`/health`, `/v1/publications`, `/v1/quota`, `/v1/media`, `/v1/media/:id/insights`, `/v1/media/:id/comments`, `/v1/accounts/check`, `/v1/discovery/:username`, `/v1/account/active-hours`...). Cada ruta compone su caso de uso.
- `cli/index.ts`: subcomandos de línea de órdenes sobre los mismos casos de uso.
- `mcp/`: servidor MCP con su propio `domain/` (`ig-gateway-port.ts`, `actions.ts`, `preview.ts`, `media-rules.ts`, `server-instructions.ts`), `application/` (`publish-preview.ts`, `publish.ts`, `execute-instagram-action.ts`, `preview-registry.ts`...) e `infrastructure/config.ts`. Llama al HTTP del servicio.

Flujo de publicación: el caso de uso valida el medio y el caption → la cuota → `GraphClient` crea el contenedor, sondea hasta `FINISHED` y llama a `media_publish` → la publicación queda en el registro JSONL. En el MCP, `publish-preview` devuelve un `preview_id` y `publish` exige ese mismo contenido.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm install` | Instala dependencias (`--frozen-lockfile` en el Makefile). |
| `pnpm build` | Typecheck y esbuild a `dist/` (CLI, HTTP y `dist/mcp/ig-mcp.mjs`). |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` / `test:coverage` / `test:watch` | Vitest. |
| `make deploy` | Depende de `release`: versionado y `git push --follow-tags`. Después build, sincroniza `dist/` y reinstala dependencias de producción en el destino, y reinicia la unidad. **Usa `sudo` y publica en remoto. No lo lances sin orden expresa.** |
| `make restart` | Reinicia la unidad (`sudo`). |
| `make release` | Exige árbol limpio, ejecuta `commit-and-tag-version` y hace push. |

`-include local.mk` en el Makefile permite una configuración de despliegue local. `local.mk` está ignorado por git: no lo versiones.

## Cómo probar un cambio

- Tests en `*.test.ts` (24 ficheros), con Vitest. Los casos de uso se prueban con `memory.ts` y dobles de los puertos.
- Para ejercitar la publicación **sin** llamar a `media_publish`, usa el modo seco: `IG_DRY_RUN` (ver el README, sección de desarrollo). Nunca pruebes publicaciones reales en los tests.
- Antes de dar un cambio por bueno: `pnpm test && pnpm typecheck && pnpm build`.
- Cada acción nueva, validación o bug corregido lleva su test en el mismo cambio.

## Convenciones

- TypeScript ESM (`"type": "module"`) con Express 5, winston y el SDK de MCP. Código en inglés, nombres de clases en PascalCase, ficheros en PascalCase en `application/` e `infrastructure/`.
- Las reglas de la API de Meta viven en `domain/` y en `mcp/domain/media-rules.ts`. Antes de cambiarlas, comprueba la documentación actual de Meta con la herramienta de docs que tengas disponible.
- Versión y `CHANGELOG.md`: `commit-and-tag-version` con `make release`. **No se editan a mano.**
- Configuración por entorno (`.env`, no versionado, a partir de `.env.example`). Los tokens de Meta nunca van al repo ni a logs.

## Decisiones y trampas

- **Sin programación.** `published=false` con `scheduled_publish_time` devuelve error. La programación es responsabilidad de cada proyecto (cron o cola), no del gateway.
- **Reintentos solo antes de publicar.** Los reintentos (0 s, 5 s, 20 s) cubren solo fallos anteriores a `media_publish`. Después de publicar, no se reintenta nunca.
- **Verificación del resultado desconocido.** Si `media_publish` falla, el gateway comprueba la cuenta: si la publicación salió, responde como publicada con `recovered: true`. No reintentes a ciegas.
- **Límite de peticiones de la app.** Es distinto de la cuota de publicación (100 cada 24 h). El gateway aplica un freno propio (`IG_MAX_CALLS_PER_MINUTE`) y una caché de cuota (`IG_QUOTA_TTL_MS`).
- **Tope de hashtags.** Se bajó de 30 a 5 (commit `1f4bec7`), que es el límite real de la API.
- **Errores de entrada.** Una entrada inválida responde 400, no 500 (commit `cea7445`).
- **MCP sin acceso directo.** No añadas una llamada del MCP a un caso de uso: rompería la cuota y el registro únicos.
- **Dependencia de dominio.** `domain/` no importa infraestructura; `application/` solo importa de `domain/`. Mantenlo al añadir código.

## Mantenimiento

- Este fichero y el `README.md` se actualizan en el mismo cambio que los deja obsoletos.
- Aquí solo va lo que puede ser público: nada de rutas locales, puertos de la máquina, IPs, perfiles de secretos ni datos personales.
