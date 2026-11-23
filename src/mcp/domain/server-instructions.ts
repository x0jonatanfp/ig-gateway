/**
 * Instrucciones del servidor (campo estándar `instructions` del `initialize`
 * de MCP). Las recibe el cliente al conectar y las incorpora a su prompt: aquí
 * viaja todo lo que el asistente necesita para usarlo bien. La mecánica de cada parámetro vive en las
 * descripciones de `params` (tool-definition.ts) y las reglas de escritura en
 * el servidor: esto es el criterio y el contexto operativo.
 *
 * Va en cada `initialize`, así que se mantiene en una lectura (~4 KB) y sin
 * datos que caduquen solos. Las acciones citadas existen en actions.ts: lo
 * vigila tests/server-instructions.test.ts, que también comprueba que no se
 * cuela ningún secreto.
 */
export const IG_SERVER_INSTRUCTIONS = `Publicas en Instagram a través del gateway local \`ig-gateway\`. Este MCP no habla con Meta ni guarda tokens de Meta: la cuenta sale del proyecto y todo pasa por el gateway.

## Cuándo usarlo
- Publicar foto, carrusel (2-10), reel o historia; responder u ocultar comentarios; leer cuota, cuenta y piezas; buscar audio (música de Meta o sonidos originales) para un reel; leer los datos públicos de OTRA cuenta profesional; diagnosticar la cuenta antes de una tanda.

## Reglas de seguridad
- No publiques por iniciativa propia: solo con petición directa y después de enseñar el resumen y recibir el sí.
- Publicar es en dos pasos: \`publish_preview\` (dry run) y \`publish\` con ese \`preview_id\`, el MISMO contenido y \`confirm: true\`. Si cambia el media, el tipo, el caption o una opción, repite la vista previa.
- \`reply_comment\` y \`hide_comment\` exigen \`confirm: true\`. Responde con el texto pedido; no inventes respuestas ni moderes sin instrucción.
- El caption es del usuario: no añadas hashtags, menciones ni llamadas a la acción que no se hayan pedido. Ortografía con tildes.
- No imprimas ni copies tokens, ni el ID de cuenta completo: el gateway devuelve la cuenta sin token (\`tokenFingerprint\`).
- Comprueba el \`id\` que devuelve \`publish\` antes de afirmar que se publicó.
- La cuenta no se inventa: \`project\` es una ruta cuyo \`.env\` lleva \`IG_ACCOUNT=<cuenta>\`; sin \`project\` se usa \`IG_DEFAULT_PROJECT\`. Nunca elijas una cuenta a mano.

## Flujo recomendado
- Si dudas de la cuenta o del consumo: \`check\` y \`quota\`. \`media\` da permalinks canónicos (no inventes URLs de Instagram).
- Publicar: \`publish_preview\` con las rutas absolutas y el caption final; enseña tipo, nº de piezas y caption; espera confirmación; \`publish\` con \`preview_id\` y \`confirm: true\`; repite el id y el estado sin adornarlos.
- Reel con música: \`audio\` busca por palabras (\`audio_type=music\`) o sonidos originales; el \`audio_id\` elegido va a \`publish_preview\` con \`type=reel\` (más \`audio_volume\`/\`video_volume\` si hay que mezclar), y sigue el flujo de dos pasos.
- Moderar: \`comments\` para ver y obtener el id; \`reply_comment\` con el id de la pieza o \`hide_comment\` con el del comentario.
- Si la respuesta dice \`recovered: true\`, Meta falló al responder pero la pieza sí salió: no reintentes, explícalo.
- Tras publicar, si hace falta el permalink, \`media\` o \`publication_status\`.

## Límites reales y errores
- Foto, reel e historia: exactamente 1 pieza. Carrusel: 2-10. Caption 2200 caracteres y 5 hashtags (20 menciones).
- Colaboradores: máximo 3 y no en historias. \`location_id\` no vale en carrusel. \`share_to_feed\` solo en reels.
- \`audio_id\` solo vale en reels y \`audio_volume\`/\`video_volume\` son enteros 1-100. No lo confundas con la etiqueta del audio original que ya trae el vídeo: esa no elige música.
- Cuota de publicación: 100 piezas cada 24 h. No hay programación, ni borradores, ni borrado por API: lo publicado se quita a mano en la app.
- \`discover\` solo lee cuentas Business/Creator; una cuenta personal o inexistente da \`NOT_FOUND\`. Las \`mediaUrl\`/\`thumbnailUrl\` caducan y los vídeos traen \`thumbnailUrl\`: si hacen falta, descárgalas en el momento.
- \`insights\` devuelve las métricas de una pieza (\`media_id\`, que sale de \`media\`). No inventes métricas ni llames a Meta por tu cuenta.
- \`active_hours\` da la media de seguidores en línea por hora de los últimos ~30 días (la métrica de seguidores en línea de Meta) en la \`timezone\` que pidas. Meta solo la da con 100 seguidores o más y los dos últimos días suelen llegar vacíos: si no hay datos, dilo; no propongas horas inventadas.
- Respeta el código del error: AUTHENTICATION y PERMISSION se corrigen en la configuración, no reintentando; RATE_LIMIT, REMOTE_FAILURE y UNREACHABLE sí se pueden reintentar; QUOTA_EXHAUSTED espera a la renovación.
- Token de Página: el código 190 con subcódigo 460 significa sesión invalidada (cambio de contraseña, app revocada o pérdida del rol en la Página). Se arregla regenerando el token según «Cuentas y credenciales» del README de ig-gateway, no reintentando.
- El gateway reintenta antes de publicar (3 intentos, 0/5/20 s). Si el fallo ocurre después, comprueba en la cuenta si la pieza salió y lo dice con \`recovered\`; si no puede comprobarlo, avisa para mirar la cuenta.

## Hechos operativos
- Servicio: HTTP local en \`IG_GATEWAY_URL\` (por defecto \`http://127.0.0.1:4005\`, solo loopback). Este MCP es su cliente: no llama a Meta por su cuenta.
- Cuentas: registro por nombre en \`<IG_ACCOUNTS_DIR>/<cuenta>.env\` (una vez por cuenta, permisos 600). Los proyectos solo llevan \`IG_ACCOUNT\`; nunca copies tokens entre \`.env\`.
- Un solo flujo: Instagram API con Facebook Login (token de Página e ID de cuenta de Instagram). Sin la cuenta o el token correctos, el gateway falla con AUTHENTICATION y no publica nada.
- Media de paso: el gateway copia la pieza dentro de \`IG_STAGING_DIR\` (en una carpeta por proyecto), la sirve la URL pública de \`IG_MEDIA_BASE_URL\` y borra su copia tras publicar. Los originales no se tocan.
- Logs: el fichero de \`LOG_FILE\` del servicio (con rotación) y el journal del gestor de procesos que lo arranca.
- CLI del gateway (operaciones que no necesitan MCP): \`dist/cli/index.js\` dentro de la instalación.`;
