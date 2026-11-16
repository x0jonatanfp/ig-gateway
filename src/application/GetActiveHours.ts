import { isValidTimeZone, summarizeActiveHours, type ActiveHours } from '../domain/ActiveHours.js';
import { PublicationError } from '../domain/PublicationError.js';
import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

/** Horas en las que más seguidores de la cuenta están en línea, en la zona pedida (UTC por defecto). */
export class GetActiveHours {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, timeZone = 'UTC', envFile?: string): Promise<ActiveHours> {
    if (!isValidTimeZone(timeZone)) {
      throw new PublicationError(`Unknown time zone: ${timeZone}`, { code: 'INVALID_REQUEST', retryable: false, status: 400 });
    }
    const account = await this.resolver.resolve(projectPath, envFile);
    return summarizeActiveHours(await this.gateway.getOnlineFollowers(account), timeZone);
  }
}
