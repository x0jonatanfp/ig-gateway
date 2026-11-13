#!/usr/bin/env node
import { GraphClient, DiskMediaStaging, EnvAccountResolver, installEnvFile, JsonlPublicationLog } from '../infrastructure/index.js';
import { CheckAccount, DiscoverAccount, GetInsights, GetQuota, ListMedia, ModerateComment, PublishMedia, PublishStory, SweepStaging } from '../application/index.js';
import { PublicationError } from '../domain/PublicationError.js';
import { toPublicAccount } from '../domain/Account.js';
import type { UserTag } from '../domain/MediaItem.js';

// La configuración del propio gateway (PORT, IG_MEDIA_BASE_URL, IG_STAGING_DIR,
// IG_GATEWAY_TOKEN) vive fuera del repo. El lanzador se la inyecta al servidor
// HTTP; el CLI la carga del `.env` de la instalación (o de `IG_GATEWAY_ENV`)
// para poder ejecutarse desde cualquier directorio.
for (const candidate of [process.env.IG_GATEWAY_ENV, installEnvFile(import.meta.url)]) {
  if (!candidate) continue;
  try { process.loadEnvFile(candidate); } catch { /* sin fichero: se usan los defaults */ }
}

const args = process.argv.slice(2);
const command = args[0];
const json = args.includes('--json');
const get = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const has = (name: string): boolean => args.includes(name);
const required = (name: string): string => { const value = get(name); if (!value) throw new PublicationError(`${name} is required`, { code: 'INVALID_REQUEST', retryable: false, status: 2 }); return value; };
const dependencies = () => ({ gateway: new GraphClient({ dryRun: has('--dry-run') }), staging: new DiskMediaStaging(), resolver: new EnvAccountResolver(), log: new JsonlPublicationLog() });
const list = (name: string): string[] => args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1] as string] : []);

async function main(): Promise<unknown> {
  const d = dependencies();
  switch (command) {
    case 'publish': {
      const media = list('--media').map((path) => ({ path }));
      if (media.length === 0) throw new PublicationError('--media is required', { code: 'INVALID_REQUEST', retryable: false, status: 2 });
      const userTagsRaw = get('--user-tags');
      const userTags = userTagsRaw ? JSON.parse(userTagsRaw) as UserTag[] : undefined;
      const collaborators = list('--collaborators');
      const input = { projectPath: required('--project'), media, caption: get('--caption') ?? '', type: (get('--type') ?? 'photo') as 'photo' | 'carousel' | 'reel' | 'story', ...(get('--idempotency-key') === undefined ? {} : { idempotencyKey: get('--idempotency-key') }), ...(get('--env-file') === undefined ? {} : { envFile: get('--env-file') }), ...(has('--dry-run') ? { dryRun: true } : {}), ...(get('--alt-text') === undefined ? {} : { altText: get('--alt-text') }), ...(userTags === undefined ? {} : { userTags }), ...(collaborators.length === 0 ? {} : { collaborators }), ...(get('--location-id') === undefined ? {} : { locationId: get('--location-id') }), ...(get('--share-to-feed') === undefined ? {} : { shareToFeed: get('--share-to-feed') !== 'false' }), ...(get('--cover-url') === undefined ? {} : { coverUrl: get('--cover-url') }), ...(get('--thumb-offset') === undefined ? {} : { thumbOffset: Number(get('--thumb-offset')) }), ...(get('--audio-name') === undefined ? {} : { audioName: get('--audio-name') }) };
      return input.type === 'story' ? new PublishStory(d.gateway, d.staging, d.resolver, d.log).execute(input) : new PublishMedia(d.gateway, d.staging, d.resolver, d.log).execute(input);
    }
    case 'check': {
      const { account, calls } = await new CheckAccount(d.gateway, d.resolver).execute(required('--project'), get('--env-file'));
      return { ...toPublicAccount(account), calls };
    }
    case 'quota': return new GetQuota(d.gateway, d.resolver).execute(required('--project'), get('--env-file'));
    case 'media': return new ListMedia(d.gateway, d.resolver).execute(required('--project'), get('--env-file'), get('--limit') === undefined ? undefined : Number(get('--limit')));
    case 'discover': return new DiscoverAccount(d.gateway, d.resolver).execute(get('--account') === undefined ? required('--project') : (get('--project') ?? ''), required('--username'), get('--env-file'), get('--limit') === undefined ? undefined : Number(get('--limit')), get('--account'));
    case 'comments': return new ModerateComment(d.gateway, d.resolver).execute(required('--project'), required('--media'), get('--reply') ? 'reply' : 'list', get('--reply'), get('--env-file'));
    case 'insights': return new GetInsights(d.gateway, d.resolver).execute(required('--project'), get('--media'), get('--env-file'));
    case 'sweep': return new SweepStaging(d.staging).execute(Number(process.env.IG_STAGING_TTL_HOURS ?? 24) * 60 * 60 * 1000);
    default: throw new PublicationError('Usage: publish|check|quota|media|discover|comments|insights|sweep', { code: 'INVALID_REQUEST', retryable: false, status: 2 });
  }
}

/** Nunca deja salir un token por stdout: quita accessToken y aplana sets. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value instanceof Set) return [...value].map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'accessToken')
        .map(([key, entry]) => [key, sanitize(entry)]),
    );
  }
  return value;
}

void main().then((result) => { const safe = sanitize(result); process.stdout.write(`${json ? JSON.stringify(safe) : `${JSON.stringify(safe, null, 2)}\n`}`); }).catch((error: unknown) => { const e = error instanceof PublicationError ? error : new PublicationError('Unexpected error', { code: 'UNKNOWN', retryable: false, status: 1, cause: error }); const output = { error: e.message, code: e.code, retryable: e.retryable, ...(e.subcode === undefined ? {} : { subcode: e.subcode }), ...(e.fbtrace === undefined ? {} : { fbtrace: e.fbtrace }) }; process.stderr.write(`${json ? JSON.stringify(output) : `${e.message}\n`}`); process.exitCode = e.status && e.status >= 2 && e.status <= 125 ? e.status : 1; });
