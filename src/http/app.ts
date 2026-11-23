import express, { type Request, type Response, type NextFunction } from 'express';
import { CheckAccount, DiscoverAccount, GetActiveHours, GetInsights, GetQuota, ListMedia, ModerateComment, PublishMedia, PublishStory, SearchAudio } from '../application/index.js';
import type { MediaInput, InstagramGatewayPort, MediaStagingPort, AccountResolverPort, PublicationLogPort } from '../domain/index.js';
import { PublicationError } from '../domain/PublicationError.js';
import { toPublicAccount } from '../domain/Account.js';
import { appLogger } from '../infrastructure/logging/Logger.js';

export interface HttpDependencies {
  gateway: InstagramGatewayPort;
  staging: MediaStagingPort;
  resolver: AccountResolverPort;
  log: PublicationLogPort;
  authToken?: string;
  rateLimit?: number;
  now?: () => number;
}

export function createApp(dependencies: HttpDependencies) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Una línea por petición al terminar: método, ruta (sin query), estado y
  // milisegundos. /health se consulta en bucle y no aporta nada al log.
  app.use((request, response, next) => {
    response.locals.startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      if (request.path === '/health') return;
      // Si acabó en error, la línea la escribe el manejador de errores: una sola por petición.
      if (response.locals.gatewayError !== undefined) return;
      appLogger.info('request', { method: request.method, route: request.path, status: response.statusCode, durationMs: elapsedMs(response) });
    });
    next();
  });
  const requests = new Map<string, { count: number; resetAt: number }>();
  const limit = dependencies.rateLimit ?? 60;
  const now = dependencies.now ?? Date.now;

  app.get('/health', (_request, response) => response.json({
    ok: true,
    service: 'ig-gateway',
    ...(dependencies.gateway.getCallStats ? { calls: dependencies.gateway.getCallStats() } : {}),
  }));
  app.use((request, response, next) => authenticate(request, response, next, dependencies.authToken));
  app.use((request, response, next) => rateLimit(request, response, next, requests, limit, now()));

  app.post('/v1/publications', asyncRoute(async (request) => {
    const body = request.body as { project?: string; media?: MediaInput[]; caption?: string; type?: 'photo' | 'carousel' | 'reel' | 'story'; idempotencyKey?: string; envFile?: string; dryRun?: boolean; altText?: string; userTags?: { username: string; x?: number; y?: number }[]; collaborators?: string[]; locationId?: string; shareToFeed?: boolean; coverUrl?: string; thumbOffset?: number; audioName?: string; audioId?: string; audioVolume?: number; videoVolume?: number };
    if (!body.project || !Array.isArray(body.media) || body.media.length === 0) throw new PublicationError('project and media are required', { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    const input = { projectPath: body.project, media: body.media, ...(body.caption === undefined ? {} : { caption: body.caption }), ...(body.type === undefined ? {} : { type: body.type }), ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }), ...(body.envFile === undefined ? {} : { envFile: body.envFile }), ...(body.dryRun === undefined ? {} : { dryRun: body.dryRun }), ...(body.altText === undefined ? {} : { altText: body.altText }), ...(body.userTags === undefined ? {} : { userTags: body.userTags }), ...(body.collaborators === undefined ? {} : { collaborators: body.collaborators }), ...(body.locationId === undefined ? {} : { locationId: body.locationId }), ...(body.shareToFeed === undefined ? {} : { shareToFeed: body.shareToFeed }), ...(body.coverUrl === undefined ? {} : { coverUrl: body.coverUrl }), ...(body.thumbOffset === undefined ? {} : { thumbOffset: body.thumbOffset }), ...(body.audioName === undefined ? {} : { audioName: body.audioName }), ...(body.audioId === undefined ? {} : { audioId: body.audioId }), ...(body.audioVolume === undefined ? {} : { audioVolume: body.audioVolume }), ...(body.videoVolume === undefined ? {} : { videoVolume: body.videoVolume }) };
    return body.type === 'story' ? new PublishStory(dependencies.gateway, dependencies.staging, dependencies.resolver, dependencies.log, { logger: appLogger }).execute(input) : new PublishMedia(dependencies.gateway, dependencies.staging, dependencies.resolver, dependencies.log, { logger: appLogger }).execute(input);
  }, 201));

  app.get('/v1/publications/:id', asyncRoute(async (request) => {
    const publication = await dependencies.log.find(pathString(request.params.id));
    if (!publication) throw new PublicationError('Publication not found', { code: 'NOT_FOUND', retryable: false, status: 404 });
    return publication;
  }));
  app.post('/v1/accounts/check', asyncRoute(async (request) => {
    const { account, calls } = await new CheckAccount(dependencies.gateway, dependencies.resolver).execute(requiredProject(request), queryString(request.body?.envFile));
    return { ...toPublicAccount(account), calls };
  }));
  app.get('/v1/quota', asyncRoute(async (request) => new GetQuota(dependencies.gateway, dependencies.resolver).execute(requiredProject(request), queryString(request.query.envFile))));
  app.get('/v1/account/active-hours', asyncRoute(async (request) => new GetActiveHours(dependencies.gateway, dependencies.resolver).execute(
    requiredProject(request),
    queryString(request.query.timezone),
    queryString(request.query.envFile),
  )));
  app.get('/v1/media', asyncRoute(async (request) => new ListMedia(dependencies.gateway, dependencies.resolver).execute(
    requiredProject(request),
    queryString(request.query.envFile),
    queryString(request.query.limit) === undefined ? undefined : Number(queryString(request.query.limit)),
  )));
  app.get('/v1/audio', asyncRoute(async (request) => new SearchAudio(dependencies.gateway, dependencies.resolver).execute(
    requiredProject(request),
    queryString(request.query.audio_type) ?? 'music',
    queryString(request.query.search_query),
    queryString(request.query.limit) === undefined ? undefined : Number(queryString(request.query.limit)),
    queryString(request.query.envFile),
  )));
  app.get('/v1/discovery/:username', asyncRoute(async (request) => new DiscoverAccount(dependencies.gateway, dependencies.resolver).execute(
    requiredProject(request),
    pathString(request.params.username),
    queryString(request.query.envFile),
    queryString(request.query.limit) === undefined ? undefined : Number(queryString(request.query.limit)),
  )));
  app.get('/v1/media/:id/insights', asyncRoute(async (request) => new GetInsights(dependencies.gateway, dependencies.resolver).execute(
    requiredProject(request),
    pathString(request.params.id),
    queryString(request.query.envFile),
  )));
  app.get('/v1/media/:id/comments', asyncRoute(async (request) => new ModerateComment(dependencies.gateway, dependencies.resolver).execute(requiredProject(request), pathString(request.params.id), 'list')));
  app.post('/v1/media/:id/comments', asyncRoute(async (request) => new ModerateComment(dependencies.gateway, dependencies.resolver).execute(requiredProject(request), pathString(request.params.id), request.body.action ?? 'reply', request.body.text)));
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const publicationError = error instanceof PublicationError ? error : new PublicationError('Internal gateway error', { code: 'UNKNOWN', retryable: false, status: 500, cause: error });
    // Todo error que sale por HTTP queda también en el log del servicio (journal), en una sola
    // línea por petición: sin esto un fallo no reintentable solo se veía en quien llamaba.
    // Solo método y ruta: ni query ni cuerpo ni cabeceras.
    response.locals.gatewayError = publicationError;
    appLogger.error('request failed', {
      method: request.method,
      route: request.path,
      status: publicationError.status ?? 500,
      durationMs: elapsedMs(response),
      code: publicationError.code,
      ...(publicationError.subcode === undefined ? {} : { subcode: publicationError.subcode }),
      retryable: publicationError.retryable,
      message: publicationError.message,
      ...(error instanceof PublicationError || !(error instanceof Error) ? {} : { cause: error.message }),
    });
    response.status(publicationError.status ?? 500).json({ error: publicationError.message, code: publicationError.code, ...(publicationError.subcode === undefined ? {} : { subcode: publicationError.subcode }), ...(publicationError.fbtrace === undefined ? {} : { fbtrace: publicationError.fbtrace }), retryable: publicationError.retryable });
  });
  return app;
}

function authenticate(request: Request, response: Response, next: NextFunction, expected?: string): void {
  if (!expected || request.path === '/health') return next();
  const received = request.header('x-ig-gateway-token');
  if (received !== expected) { response.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}
function rateLimit(request: Request, response: Response, next: NextFunction, entries: Map<string, { count: number; resetAt: number }>, limit: number, now: number): void {
  const key = request.ip ?? 'unknown';
  for (const [entryKey, entry] of entries) if (entry.resetAt <= now) entries.delete(entryKey);
  const current = entries.get(key);
  if (!current) { entries.set(key, { count: 1, resetAt: now + 60_000 }); return next(); }
  current.count += 1;
  if (current.count > limit) { response.status(429).json({ error: 'Rate limit exceeded' }); return; }
  next();
}
function asyncRoute(handler: (request: Request) => Promise<unknown>, successStatus = 200) { return (request: Request, response: Response, next: NextFunction) => { void handler(request).then((result) => response.status(successStatus).json(result)).catch(next); }; }
function requiredProject(request: Request): string { const project = (request.body?.project ?? request.query.project) as unknown; if (typeof project !== 'string' || !project) throw new PublicationError('project is required', { code: 'INVALID_REQUEST', retryable: false, status: 400 }); return project; }
function queryString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function pathString(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
/** Milisegundos desde que el middleware de medidas marcó la petición. */
function elapsedMs(response: Response): number {
  const startedAt = response.locals.startedAt as bigint | undefined;
  return startedAt === undefined ? 0 : Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}
