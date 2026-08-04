export interface ProviderBalanceInfo {
  currency: 'CNY' | 'USD';
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

export type ProviderBalance = {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'not_queried';
} | {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'ok';
  cached: boolean;
  fetched_at: number;
  is_available: boolean;
  balance_infos: ProviderBalanceInfo[];
} | {
  channel_id: string;
  channel_name: string;
  provider: 'deepseek';
  status: 'error';
  error: string;
};

export interface ProviderBalancesResponse {
  balances: ProviderBalance[];
  cache_ttl_seconds: number;
}

export function balanceCurrencySymbol(currency: ProviderBalanceInfo['currency']): string {
  return currency === 'CNY' ? '¥' : '$';
}

export function balanceUpdatedAt(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}
