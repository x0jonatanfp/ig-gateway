import { createServer } from 'node:http';
import { createApp } from './app.js';
import { GraphClient, DiskMediaStaging, EnvAccountResolver, JsonlPublicationLog } from '../infrastructure/index.js';
import { logger } from '../infrastructure/logging/Logger.js';

const httpDependencies = { gateway: new GraphClient(), staging: new DiskMediaStaging(), resolver: new EnvAccountResolver(), log: new JsonlPublicationLog(), ...(process.env.IG_GATEWAY_TOKEN === undefined ? {} : { authToken: process.env.IG_GATEWAY_TOKEN }) };
const app = createApp(httpDependencies);
const port = Number(process.env.PORT ?? 4005);
createServer(app).listen(port, '127.0.0.1', () => { logger.info(`ig-gateway listening on 127.0.0.1:${port}`); });
