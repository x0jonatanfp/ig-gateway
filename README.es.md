# ig-gateway

[English](README.md) · **Español**

Servicio aislado que centraliza el acceso a la Instagram Graph API para otros
proyectos locales. Guarda los tokens de Página, respeta la cuota de publicación y
los límites de peticiones, prepara las copias de media que Instagram tiene que
descargar y registra cada publicación. Quien lo llama no ve ningún token: solo
dice qué cuenta usa.

Tres puntos de entrada comparten los mismos casos de uso: una API HTTP, un CLI y
un servidor MCP para agentes.

## Qué hace

- Publica foto, carrusel (2–10), reel e historia.
- Lee la cuenta, la cuota de publicación, la lista de piezas y los insights de
  una pieza.
- Lista, responde y oculta comentarios.
- Lee los datos públicos (perfil, contadores y hasta 100 piezas) de **otra**
  cuenta Business/Creator mediante Business Discovery.
- Usa un flujo de publicación en dos pasos (vista previa y confirmación) para que
  nada se publique por accidente.

## Arquitectura

Hexagonal, con las dependencias hacia dentro:

| Directorio | Contenido |
| --- | --- |
| `src/domain/` | Entidades, errores y puertos (`Account`, `MediaItem`, `Publication`, `PublicationError`, `ports.ts`). Lógica pura: sin E/S, sin config, sin logger. |
| `src/application/` | Casos de uso que solo hablan con esos puertos: `PublishMedia`, `PublishStory`, `CheckAccount`, `GetQuota`, `ListMedia`, `GetInsights`, `DiscoverAccount`, `ModerateComment`, `SweepStaging`. |
| `src/infrastructure/` | Adaptadores, la única capa que toca red, disco o Meta: `GraphClient` (Graph API), `DiskMediaStaging` (copias preparadas), `EnvAccountResolver` (registro de cuentas), `JsonlPublicationLog` (registro de publicaciones), `Logger`. |
| `src/http/`, `src/cli/`, `src/mcp/` | Tres adaptadores de entrada. Cada uno es un composition root que conecta la infraestructura con los casos de uso. |

El servidor MCP repite la misma separación (`src/mcp/domain`, `application`,
`infrastructure`) y **no** llama a los casos de uso a propósito: es un cliente
HTTP del servicio en marcha, así la cuota, el freno de llamadas y el registro de
publicaciones siguen en un solo sitio.

## Acciones del MCP

El servidor expone una única tool, `instagram`, con `action` más `params`:

| Acción | Tipo | Qué hace |
| --- | --- | --- |
| `check` | lectura | Resuelve la cuenta del proyecto e informa de contadores y llamadas a Meta. |
| `quota` | lectura | Cuota de publicación usada, total y restante. |
| `media` | lectura | Últimas piezas con sus permalinks canónicos. |
| `insights` | lectura | Métricas de una pieza (`media_id`). |
| `comments` | lectura | Comentarios de una pieza. |
| `discover` | lectura | Datos públicos de otra cuenta Business/Creator. |
| `publication_status` | lectura | Estado de una publicación por su id del gateway. |
| `publish_preview` | escritura | Dry run: valida el media y devuelve un `preview_id`. |
| `publish` | escritura | Publica una vista previa creada en el mismo proceso. |
| `reply_comment` | escritura | Responde a un comentario. |
| `hide_comment` | escritura | Oculta un comentario. |

Ninguna de las cuatro acciones de escritura se ejecuta sin `confirm: true`
explícito. Además, `publish` exige el `preview_id` que devolvió
`publish_preview` **en el mismo proceso** y contenido idéntico (tipo, media,
caption y opciones se resumen con SHA-256; cualquier cambio anula la vista
previa).

## Puesta en marcha desde cero

### 1. Crear una app de Meta

Crea una app en [Meta for Developers](https://developers.facebook.com/) y añade
el producto **Instagram API with Facebook Login**. Business Discovery,
publicación, comentarios e insights van todos por `graph.facebook.com` con un
**token de Página** de Facebook; el flujo antiguo de Instagram Login no está
soportado.

### 2. Cuenta de Instagram y Página

Hace falta una cuenta de Instagram **profesional** (Business o Creator) vinculada
a una Página de Facebook que administres. La cuenta se consulta por su ID: con un
token de Página, `/me` es la Página, no la cuenta de Instagram.

### 3. Permisos

`instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_insights`, `pages_show_list` y `pages_read_engagement`. Leer
mensajes exigiría además `instagram_manage_messages` (y activar el acceso a
mensajes en los ajustes de la cuenta de Instagram).

El token de Página no caduca por tiempo (`debug_token`: tipo `PAGE`,
`expires_at` 0), pero se invalida si cambia la contraseña de Facebook, se revoca
la app o se pierde el rol en la Página (error 190). El token de **usuario** que
hay detrás sí caduca: el acceso de la app a los datos
(`data_access_expires_at`) se agota en algún momento y entonces hay que repetir
el ciclo completo.

### 4. Sacar el token de Página

Con un token de usuario largo que lleve los permisos de arriba:

```
GET /<page-id>?fields=access_token,instagram_business_account{id,username}
```

Los IDs de Página salen de `granular_scopes` (`pages_show_list`) cuando
`me/accounts` vuelve vacío. Después comprueba cada token de Página con
`debug_token` (tipo `PAGE`, `expires_at` 0).

### 5. Crear el fichero del registro de cuentas

Cada cuenta se define **una vez**, en `<IG_ACCOUNTS_DIR>/<nombre>.env` (modo 600,
nunca en git; el directorio por defecto es `./data/accounts`):

```
IG_FB_PAGE_TOKEN=…
IG_FB_ACCOUNT_ID=…        # el ID de la cuenta de Instagram, no el de la Página
IG_USERNAME=example_studio
```

Claves opcionales: `IG_CAPABILITY_ALT_TEXT`, `IG_CAPABILITY_USER_TAGS`,
`IG_CAPABILITY_COLLABORATORS`, `IG_CAPABILITY_LOCATION` (`0` desactiva esa
función para la cuenta).

### 6. Apuntar un proyecto a la cuenta

Los proyectos no copian ningún token; solo dicen qué cuenta usan en su propio
`.env`:

```
IG_ACCOUNT=example_studio
```

`--account <nombre>` en el CLI manda sobre `IG_ACCOUNT` y no necesita proyecto.
Las claves del registro mandan sobre las del proyecto; un proyecto sin
`IG_ACCOUNT` sigue funcionando con sus propios `IG_FB_PAGE_TOKEN` y
`IG_FB_ACCOUNT_ID`. Si la cuenta no está en el registro, el error es
`AUTHENTICATION` y no se publica nada.

### 7. Servir el media por HTTPS público

Instagram solo descarga la copia preparada desde una URL HTTPS pública, así que
`IG_MEDIA_BASE_URL` tiene que apuntar a una ruta servida por tu servidor web. El
snippet de [`deploy/nginx/ig-media.conf`](deploy/nginx/ig-media.conf) habilita
solo GET/HEAD sobre ese directorio; ajusta el `alias` a tu ruta de instalación:

```nginx
location ^~ /ig-media/ {
    alias /opt/ig-gateway/data/media/;
    limit_except GET HEAD { deny all; }
    autoindex off;
    try_files $uri =404;
}
```

```
IG_MEDIA_BASE_URL=https://your-domain.example/ig-media
```

### 8. Arrancar el servicio

```bash
pnpm install
cp .env.example .env      # rellena IG_GATEWAY_TOKEN, IG_MEDIA_BASE_URL, …
chmod 600 .env
pnpm build
node dist/http/server.js
```

El servidor HTTP escucha solo en loopback. `GET /health` no pide autenticación;
el resto de rutas exigen la cabecera `x-ig-gateway-token`.

### 9. Registrar el servidor MCP

Cualquier cliente MCP stdio puede lanzarlo (el build sale en
`dist/mcp/ig-mcp.mjs`):

```json
{
  "mcpServers": {
    "ig-gateway": {
      "command": "node",
      "args": ["/opt/ig-gateway/dist/mcp/ig-mcp.mjs"],
      "env": {
        "IG_GATEWAY_URL": "http://127.0.0.1:4005",
        "IG_GATEWAY_TOKEN": "<token-del-servicio>",
        "IG_DEFAULT_PROJECT": "/ruta/al/proyecto"
      }
    }
  }
}
```

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP, solo loopback. Por defecto `4005`. |
| `IG_GRAPH_VERSION` | Versión de la Graph API. Por defecto `v27.0`. |
| `IG_MEDIA_BASE_URL` | URL pública desde la que Instagram descarga. Obligatoria para publicar. |
| `IG_GATEWAY_TOKEN` | Token esperado en `x-ig-gateway-token`. |
| `IG_ACCOUNTS_DIR` | Directorio del registro de cuentas. Por defecto `./data/accounts`. |
| `IG_STAGING_DIR` | Copias de media preparadas. Por defecto `./data/media`. |
| `IG_STAGING_TTL_HOURS` | Antigüedad tras la que `sweep` borra copias huérfanas. Por defecto `24`. |
| `IG_PUBLICATION_LOG` | Registro de publicaciones (JSONL). Por defecto `./data/logs/publications.jsonl`. |
| `IG_CALLS_LOG` | Contador compartido de llamadas; vacío lo deja solo en el proceso. |
| `IG_QUOTA_TTL_MS` | Caché de la cuota. Por defecto `300000` (5 min). |
| `IG_MAX_CALLS_PER_MINUTE` | Freno suave de llamadas a Meta. Por defecto `30`. |
| `IG_DRY_RUN` | `1` recorre el flujo sin llamar a `media_publish`. |
| `IG_GATEWAY_ENV` | Solo CLI: fichero de entorno que cargar en vez de `<install>/.env`. |
| `LOG_FILE` | Fichero de log de la aplicación. Por defecto `/var/log/ig-gateway.log`. |
| `LOG_LEVEL` | Nivel de log. Por defecto `info`. |
| `IG_GATEWAY_URL` | Solo MCP: base del gateway. Por defecto `http://127.0.0.1:4005`. |
| `IG_GATEWAY_TOKEN` | Solo MCP: el mismo token del servicio. |
| `IG_DEFAULT_PROJECT` | Solo MCP: proyecto usado cuando la tool no recibe ninguno. |

El CLI lee `<install>/.env` (dos niveles por encima de `dist/cli/index.js`), así
que funciona desde cualquier directorio.

## Límites reales de la API de Meta

- Foto, reel e historia llevan exactamente una pieza; el carrusel, de 2 a 10.
  Caption de hasta 2200 caracteres y 30 hashtags (20 menciones).
- `alt_text`, `user_tags`, `collaborators` (máximo 3, no en historias),
  `cover_url`, `thumb_offset`, `audio_name` y `share_to_feed` (solo reels) se
  admiten según lo que permita cada tipo; `location_id` no vale en carrusel.
- **No hay programación** (`published=false` con `scheduled_publish_time`
  devuelve HTTP 500, código 1), ni borradores, ni borrado por API: la
  programación es del cron o la cola de cada proyecto, y lo publicado se quita a
  mano en la app.
- `is_paid_partnership` y `branded_content_sponsor_ids` devuelven 400
  (subcódigo 2207109).
- Cuota de publicación: 100 piezas cada 24 h por cuenta.

## Consumo de la API y resiliencia

Instagram tiene dos límites distintos: la **cuota de publicación** y el **límite
de peticiones de la app** (código 4, «Application request limit reached»), que es
el que se dispara con ráfagas. El gateway está afinado para gastar lo mínimo:

- **Sondeo adaptativo**: tras crear el contenedor se pregunta con espera
  creciente (2 s → 15 s). Perfiles distintos para imagen (tope 45 s) y vídeo
  (tope 6 min). Una foto normal se publica con una sola comprobación.
- **Cuota cacheada** 5 minutos por cuenta (`IG_QUOTA_TTL_MS`); se pregunta
  siempre si queda menos del 20 % de margen, y tras publicar sube sola.
- **Reintentos con espera** (0 s, 5 s, 20 s) y solo para fallos anteriores a
  `media_publish`. Después de publicar no se reintenta nunca.
- **Verificación del resultado desconocido**: si `media_publish` falla, se
  comprueba en la cuenta si la pieza salió. Si salió, se devuelve como publicada
  (`recovered: true`); si se confirma que no salió, el error es reintentable; si
  no se puede comprobar, se informa y no se reintenta.
- **Freno suave**: como mucho `IG_MAX_CALLS_PER_MINUTE` llamadas por minuto (30
  por defecto). Si se alcanza, espera; nunca falla por esto.
- **Contador visible**: `check` y `/health` informan de las llamadas hechas en la
  última hora y en el último minuto.

## Desarrollo

```bash
pnpm install
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm build
```

Para probar la publicación sin llamar a `media_publish`:

```bash
IG_DRY_RUN=1 pnpm exec ig-gateway publish --project /ruta/proyecto --media imagen.jpg --caption "Prueba" --dry-run --json
```

Leer otra cuenta:

```bash
node dist/cli/index.js discover --account example_studio --username example_brand --limit 8 --json
```

Solo lectura: devuelve el perfil, los contadores y hasta 100 piezas (25 por
página). Las `mediaUrl`/`thumbnailUrl` de Meta caducan, así que quien las use
debe descargar las imágenes; las piezas `VIDEO` traen `thumbnailUrl` y no
`mediaUrl`. Un objetivo personal o inexistente da `NOT_FOUND`. Lo mismo está
disponible por HTTP: `GET /v1/discovery/:username?project=…&limit=…` y las
métricas de una pieza con `GET /v1/media/:id/insights?project=…`.

No se deben guardar tokens reales en el repositorio: el resolutor lee el `.env`
del proyecto llamador mediante `--env-file`, `.env` o cualquier `.env.*` que
contenga los nombres soportados.

## Despliegue de ejemplo

Compila, copia `dist/` y las dependencias de producción a su lado, y ejecuta
`dist/http/server.js` como servicio. [`deploy/ig-gateway.service.example`](deploy/ig-gateway.service.example)
es una unidad de systemd con los secretos en un `EnvironmentFile` fuera del
repositorio; [`Makefile`](Makefile) automatiza los mismos pasos: `make deploy`
instala en `DEST` y `make deploy DEST=/ruta` elige otro prefijo, que un
`local.mk` ignorado por git (`DEST := …`) conserva para la siguiente ejecución.

El directorio de media tiene que ser legible por el servidor web que sirve
`IG_MEDIA_BASE_URL`, e `IG_STAGING_DIR` tiene que coincidir con el `alias` de
nginx.

## Licencia

MIT — ver [LICENSE](LICENSE).
