export interface Quota {
  quotaUsage: number;
  quotaTotal: number;
  quotaRemaining: number;
  quotaDuration?: number;
  resetAt?: string;
}

export function isQuotaExhausted(quota: Quota): boolean {
  return quota.quotaRemaining <= 0 || quota.quotaUsage >= quota.quotaTotal;
}

export function createQuota(quotaUsage: number, quotaTotal = 100, quotaDuration?: number): Quota {
  return {
    quotaUsage,
    quotaTotal,
    quotaRemaining: Math.max(0, quotaTotal - quotaUsage),
    ...(quotaDuration === undefined ? {} : { quotaDuration }),
  };
}
