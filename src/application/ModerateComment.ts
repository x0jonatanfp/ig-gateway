import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

export class ModerateComment {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, mediaId: string, action: 'list' | 'reply' | 'hide' | 'unhide' | 'delete' | 'open' | 'close', value?: string, envFile?: string) {
    const account = await this.resolver.resolve(projectPath, envFile);
    return this.gateway.moderateComment(account, mediaId, action, value);
  }
}
