import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { installEnvFile } from '../src/infrastructure/index.js';

// El banner inyecta un `require` (como el build real) porque winston y sus
// dependencias son CJS: sin él, esbuild falla al generar el bundle ESM.
const BUNDLE_BANNER = "import{createRequire}from'module';const require=createRequire(import.meta.url);";

function runCli(args: string[]) { return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => { const child = spawn(process.execPath, [join(process.cwd(), 'node_modules/esbuild/bin/esbuild'), 'src/cli/index.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=/tmp/ig-gateway-cli-test.mjs', `--banner:js=${BUNDLE_BANNER}`], { cwd: process.cwd() }); let output = ''; let error = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; }); child.on('close', () => { const command = spawn(process.execPath, ['/tmp/ig-gateway-cli-test.mjs', ...args], { cwd: process.cwd() }); let stdout = ''; let stderr = ''; command.stdout.on('data', (chunk) => { stdout += chunk; }); command.stderr.on('data', (chunk) => { stderr += chunk; }); command.on('close', (code) => resolve({ code, stdout, stderr })); }); }); }

describe('CLI', () => {
  it('returns JSON usage errors with exit code 2', async () => { const result = await runCli(['unknown', '--json']); expect(result.code).toBe(2); expect(JSON.parse(result.stderr)).toMatchObject({ code: 'INVALID_REQUEST' }); });
  it('requires media and project safely', async () => { const result = await runCli(['publish', '--json']); expect(result.code).toBe(2); expect(result.stderr).toContain('media'); });

  it('carga el .env de la instalación, no una ruta absoluta', () => {
    // dist/cli/index.js y src/cli/index.ts suben dos niveles hasta la raíz.
    expect(installEnvFile('file:///opt/ig-gateway/dist/cli/index.js')).toBe('/opt/ig-gateway/.env');
    expect(installEnvFile('file:///opt/app/ig-gateway/src/cli/index.ts')).toBe('/opt/app/ig-gateway/.env');
  });
});
