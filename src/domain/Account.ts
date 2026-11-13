export type AccountCapability =
  | 'media'
  | 'stories'
  | 'comments'
  | 'insights'
  | 'conversations'
  | 'quota'
  | 'alt_text'
  | 'user_tags'
  | 'collaborators'
  | 'location';

export interface Account {
  id: string;
  username: string;
  accessToken: string;
  capabilities: ReadonlySet<AccountCapability>;
  tokenFingerprint: string;
  accountType?: string;
  name?: string;
  mediaCount?: number;
  followersCount?: number;
  biography?: string;
  website?: string;
}

export function hasCapability(account: Account, capability: AccountCapability): boolean {
  return account.capabilities.has(capability);
}

export function mediaCapabilityFor(type: 'photo' | 'carousel' | 'reel' | 'story'): AccountCapability {
  return type === 'story' ? 'stories' : 'media';
}

/** Vista de una cuenta sin el token: es lo único que puede salir por CLI o HTTP. */
export type PublicAccount = Omit<Account, 'accessToken' | 'capabilities'> & {
  capabilities: AccountCapability[];
};

export function toPublicAccount(account: Account): PublicAccount {
  const { accessToken: _accessToken, capabilities, ...rest } = account;
  return { ...rest, capabilities: [...capabilities] };
}
