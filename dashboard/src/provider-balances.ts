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

const rememberedBalances = new Map<string, ProviderBalance>();
const MAX_REMEMBERED_BALANCES = 200;
const SESSION_STORAGE_KEY = 'mygateway.provider-balances';
let hydrated = false;

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserSessionStorage = () => (
  globalThis as typeof globalThis & { sessionStorage?: SessionStorageLike }
).sessionStorage;

function hydrateRememberedBalances(): void {
  if (hydrated) return;
  hydrated = true;
  const storage = browserSessionStorage();
  if (!storage) return;
  try {
    const stored = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? '[]') as ProviderBalance[];
    if (!Array.isArray(stored)) return;
    for (const balance of stored.slice(-MAX_REMEMBERED_BALANCES)) {
      if (balance && typeof balance.channel_id === 'string'
        && (balance.status === 'ok' || balance.status === 'error')) {
        rememberedBalances.set(balance.channel_id, balance);
      }
    }
  } catch { /* A malformed browser value is safely ignored. */ }
}

function persistRememberedBalances(): void {
  const storage = browserSessionStorage();
  if (!storage) return;
  try { storage.setItem(SESSION_STORAGE_KEY, JSON.stringify([...rememberedBalances.values()])); }
  catch { /* Storage disabled or full: in-memory behavior still works. */ }
}

function remember(balance: ProviderBalance): void {
  hydrateRememberedBalances();
  if (balance.status === 'not_queried') return;
  rememberedBalances.delete(balance.channel_id);
  rememberedBalances.set(balance.channel_id, balance);
  while (rememberedBalances.size > MAX_REMEMBERED_BALANCES) {
    const oldest = rememberedBalances.keys().next().value as string | undefined;
    if (!oldest) break;
    rememberedBalances.delete(oldest);
  }
  persistRememberedBalances();
}

/**
 * Worker balance caches are isolate-local. A later cache-only overview may
 * therefore return not_queried even after this browser just refreshed another
 * isolate. Keep the last resolved browser value instead of regressing the UI.
 *
 * The remembered map is the single source of truth: passing the page signal
 * back in here would re-remember values that were explicitly forgotten
 * (e.g. after editing a channel's key or deleting it), resurrecting a stale
 * balance for an account that no longer matches the channel.
 */
export function mergeProviderBalances(incoming: ProviderBalance[]): ProviderBalance[] {
  hydrateRememberedBalances();
  const merged = incoming.map((balance) => {
    if (balance.status !== 'not_queried') return balance;
    const remembered = rememberedBalances.get(balance.channel_id);
    if (!remembered) return balance;
    // Served from the browser's last resolved value rather than a fresh
    // worker response — mark it so the UI can show it is not newly fetched.
    return remembered.status === 'ok' ? { ...remembered, cached: true } : remembered;
  });
  for (const balance of merged) remember(balance);
  return merged;
}

export function forgetProviderBalance(channelId: string): void {
  hydrateRememberedBalances();
  rememberedBalances.delete(channelId);
  persistRememberedBalances();
}

export function balanceCurrencySymbol(currency: ProviderBalanceInfo['currency']): string {
  return currency === 'CNY' ? '¥' : '$';
}

export function balanceUpdatedAt(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}
