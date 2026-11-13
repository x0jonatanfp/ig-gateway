import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import winston from 'winston';

// LOG_FILE se lee al cargar el módulo, así que se fija antes del import dinámico.
const dir = mkdtempSync(join(tmpdir(), 'ig-gateway-log-'));
const logFile = join(dir, 'ig-gateway.log');
process.env.LOG_FILE = logFile;

const { logger } = await import('../src/infrastructure/logging/Logger.js');

describe('Logger', () => {
  it('escribe aplicación y error en el mismo fichero, en JSON', async () => {
    // La consola va a stderr: stdout es solo la salida de máquina del CLI, y
    // un aviso suelto ahí rompía el JSON que parsean storyteller y predictions
    // («Unexpected non-whitespace character after JSON»).
    const consoleTransport = logger.transports.find((transport) => transport instanceof winston.transports.Console);
    expect(consoleTransport?.stderrLevels).toMatchObject({ error: true, warn: true, info: true });

    logger.info('[test] línea de info');
    logger.error('[test] línea de error');
    // end() espera a que los transports emitan 'finish' antes de leer.
    await new Promise<void>((resolve) => logger.end(resolve));

    const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const [info, error] = lines.map((line) => JSON.parse(line));
    expect(info).toMatchObject({ level: 'info', message: '[test] línea de info' });
    expect(error).toMatchObject({ level: 'error', message: '[test] línea de error' });
    expect(typeof info.timestamp).toBe('string');
  });
});
