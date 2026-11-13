import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PublicationError } from '../../domain/PublicationError.js';
import type { Account, AccountCapability } from '../../domain/Account.js';
import type { AccountResolverPort } from '../../domain/ports.js';

// Un solo flujo: Instagram API con Facebook Login (token de Página + ID de la
// cuenta de Instagram vinculada). Ya no se aceptan las claves de Instagram Login.
const tokenNames = ['IG_FB_PAGE_TOKEN'] as const;
const accountNames = ['IG_FB_ACCOUNT_ID'] as const;

/** Nombre de cuenta del registro: letras, números, punto, guion y guion bajo. */
const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Cada cuenta de Instagram se define UNA vez en el registro del gateway
 * (`<IG_ACCOUNTS_DIR>/<nombre>.env`, modo 600) y los proyectos solo dicen cuál
 * usan (`IG_ACCOUNT=<nombre>` en su .env, o `--account` en el CLI). Así el token
 * no se copia a cada proyecto. Un proyecto sin `IG_ACCOUNT` sigue funcionando
 * con las claves de su propio .env.
 */
export class EnvAccountResolver implements AccountResolverPort {
  constructor(private readonly accountsDir: string = process.env.IG_ACCOUNTS_DIR ?? './data/accounts') {}

  async resolve(projectPath: string, explicitEnvFile?: string, accountName?: string): Promise<Account> {
    const { values, envPath } = await this.load(projectPath, explicitEnvFile, accountName);
    const token = firstValue(values, tokenNames);
    const id = firstValue(values, accountNames);
    if (!token) throw new PublicationError(`No IG_FB_PAGE_TOKEN found in ${envPath}`, { code: 'AUTHENTICATION', retryable: false });
    if (!id) throw new PublicationError(`No IG_FB_ACCOUNT_ID found in ${envPath}`, { code: 'AUTHENTICATION', retryable: false });
    const capabilities: ReadonlySet<AccountCapability> = new Set([
      'media', 'stories', 'comments', 'insights', 'conversations', 'quota',
      ...(values.IG_CAPABILITY_ALT_TEXT === '0' ? [] : ['alt_text' as const]),
      ...(values.IG_CAPABILITY_USER_TAGS === '0' ? [] : ['user_tags' as const]),
      ...(values.IG_CAPABILITY_COLLABORATORS === '0' ? [] : ['collaborators' as const]),
      ...(values.IG_CAPABILITY_LOCATION === '0' ? [] : ['location' as const]),
    ]);
    return { id, username: values.IG_USERNAME ?? `account-${id}`, accessToken: token, capabilities, tokenFingerprint: fingerprintToken(token), ...(values.IG_ACCOUNT_TYPE === undefined ? {} : { accountType: values.IG_ACCOUNT_TYPE }) };
  }

  /** Lee el .env del proyecto (si lo hay) y le aplica la cuenta del registro que indique IG_ACCOUNT o `--account`. */
  private async load(projectPath: string, explicitEnvFile?: string, accountName?: string): Promise<{ values: Record<string, string>; envPath: string }> {
    // Con --account el proyecto es opcional: la cuenta sale solo del registro.
    const projectEnv = projectPath === '' && accountName !== undefined ? undefined : await this.findEnv(projectPath, explicitEnvFile);
    const projectValues = projectEnv === undefined ? {} : parseEnv(await readFile(projectEnv, 'utf8'));
    const name = accountName ?? projectValues.IG_ACCOUNT;
    if (name === undefined || name === '') return { values: projectValues, envPath: projectEnv as string };
    if (!ACCOUNT_NAME.test(name)) throw new PublicationError(`Invalid account name: ${name}`, { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    const accountPath = join(this.accountsDir, `${name}.env`);
    let content: string;
    try { content = await readFile(accountPath, 'utf8'); } catch { throw new PublicationError(`Account "${name}" not found in ${this.accountsDir}`, { code: 'AUTHENTICATION', retryable: false }); }
    return { values: { ...projectValues, ...parseEnv(content) }, envPath: accountPath };
  }

  private async findEnv(projectPath: string, explicitEnvFile?: string): Promise<string> {
    if (explicitEnvFile) {
      try { await access(explicitEnvFile); return explicitEnvFile; } catch { throw new PublicationError(`Explicit env file not found: ${explicitEnvFile}`, { code: 'AUTHENTICATION', retryable: false }); }
    }
    const direct = join(projectPath, '.env');
    try { await access(direct); return direct; } catch { /* continue */ }
    const names = await readdir(projectPath).catch(() => []);
    const candidates = names.filter((name) => name.startsWith('.env.') && !name.endsWith('.example')).sort();
    for (const candidate of candidates) {
      const path = join(projectPath, candidate);
      const values = parseEnv(await readFile(path, 'utf8'));
      if (firstValue(values, tokenNames)) return path;
    }
    throw new PublicationError(`No usable .env file found in ${projectPath}`, { code: 'AUTHENTICATION', retryable: false });
  }
}

function parseEnv(content: string): Record<string, string> {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const separator = trimmed.indexOf('=');
    if (separator < 1) return [];
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    return [[key, value]];
  }));
}
function firstValue(values: Record<string, string>, names: readonly string[]): string | undefined { return names.map((name) => values[name]).find((value) => Boolean(value)); }
export function fingerprintToken(token: string): string { return createHash('sha256').update(token).digest('hex').slice(0, 12); }
