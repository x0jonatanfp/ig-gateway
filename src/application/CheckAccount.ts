import type { Account } from '../domain/Account.js';
import type { AccountResolverPort, InstagramGatewayPort } from '../domain/ports.js';

export interface AccountCheck {
  account: Account;
  calls: { callsLastHour: number; callsLastMinute: number; maxCallsPerMinute: number };
}

export class CheckAccount {
  constructor(private readonly gateway: InstagramGatewayPort, private readonly resolver: AccountResolverPort) {}
  async execute(projectPath: string, envFile?: string): Promise<AccountCheck> {
    const account = await this.resolver.resolve(projectPath, envFile);
    const checked = await this.gateway.checkAccount(account);
    const calls = this.gateway.getCallStats?.() ?? { callsLastHour: 0, callsLastMinute: 0, maxCallsPerMinute: 0 };
    return { account: checked, calls };
  }
}
