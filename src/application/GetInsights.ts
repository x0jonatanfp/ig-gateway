import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

/** Métricas de una pieza (o de la cuenta si no se pasa mediaId). */
export class GetInsights {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, mediaId?: string, envFile?: string) {
    const account = await this.resolver.resolve(projectPath, envFile);
    return this.gateway.getInsights(account, mediaId);
  }
}
