import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

/** Lista las piezas publicadas en la cuenta con su permalink canónico. */
export class ListMedia {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, envFile?: string, limit?: number) {
    const account = await this.resolver.resolve(projectPath, envFile);
    return this.gateway.listMedia(account, limit);
  }
}
