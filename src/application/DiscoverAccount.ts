import { PublicationError } from '../domain/PublicationError.js';
import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

/** Los usernames de Instagram: letras, números, punto y guion bajo, hasta 30. */
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** Lee los datos públicos de otra cuenta profesional (solo lectura). */
export class DiscoverAccount {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, username: string, envFile?: string, limit?: number, accountName?: string) {
    const target = username.replace(/^@/, '');
    if (!USERNAME.test(target)) throw new PublicationError('Invalid Instagram username', { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new PublicationError('limit must be a non-negative integer', { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    const account = await this.resolver.resolve(projectPath, envFile, accountName);
    return this.gateway.discoverAccount(account, target, limit);
  }
}
