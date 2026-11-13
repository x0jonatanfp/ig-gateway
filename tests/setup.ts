import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Los tests escriben avisos con el logger real. Sin esto van al fichero de
// producción (/var/log/ig-gateway.log) y ensucian un registro que se usa como
// evidencia: el 17-sep aparecieron reintentos con el identificador "one" que
// eran de las propias pruebas, no de publicaciones reales.
process.env.LOG_FILE ??= join(tmpdir(), 'ig-gateway-tests.log');
