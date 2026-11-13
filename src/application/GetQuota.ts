import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

export class GetQuota {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, envFile?: string) {
    const account = await this.resolver.resolve(projectPath, envFile);
    return this.gateway.getQuota(account);
  }
}
