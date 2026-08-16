import { describe, expect, test } from 'vitest';
import {
  forgetProviderBalance,
  mergeProviderBalances,
  type ProviderBalance,
} from '../dashboard/src/provider-balances.ts';

const okBalance = (channelId: string, total: string): ProviderBalance => ({
  channel_id: channelId,
  channel_name: 'DeepSeek',
  provider: 'deepseek',
  status: 'ok',
  cached: false,
  fetched_at: 1_786_000_000,
  is_available: true,
  balance_infos: [{
    currency: 'CNY',
    total_balance: total,
    granted_balance: '0.00',
    topped_up_balance: total,
  }],
});

const notQueried = (channelId: string): ProviderBalance => ({
  channel_id: channelId,
  channel_name: 'DeepSeek',
  provider: 'deepseek',
  status: 'not_queried',
});

describe('provider balance browser state', () => {
  test('another isolate not_queried response cannot erase a refreshed value', () => {
    const channelId = 'ui-balance-ok';
    const refreshed = mergeProviderBalances([okBalance(channelId, '42.10')]);
    const overview = mergeProviderBalances([notQueried(channelId)]);
    expect(overview[0]).toMatchObject({ status: 'ok', balance_infos: [{ total_balance: '42.10' }] });
  });

  test('a remembered value served for not_queried is marked as cached', () => {
    const channelId = 'ui-balance-cached-marker';
    mergeProviderBalances([okBalance(channelId, '42.10')]);
    const overview = mergeProviderBalances([notQueried(channelId)]);
    expect(overview[0]).toMatchObject({ status: 'ok', cached: true });
  });

  test('an explicit refresh error replaces the previous successful value', () => {
    const channelId = 'ui-balance-error';
    mergeProviderBalances([okBalance(channelId, '42.10')]);
    const error: ProviderBalance = {
      channel_id: channelId,
      channel_name: 'DeepSeek',
      provider: 'deepseek',
      status: 'error',
      error: 'Provider unavailable',
    };
    const refreshed = mergeProviderBalances([error]);
    expect(refreshed[0]).toEqual(error);
  });

  test('an unqueried channel with no browser value remains unqueried', () => {
    expect(mergeProviderBalances([notQueried('ui-balance-new')])[0].status).toBe('not_queried');
  });

  test('editing a channel forgets a value that may belong to the previous key', () => {
    const channelId = 'ui-balance-edited';
    mergeProviderBalances([okBalance(channelId, '42.10')]);
    forgetProviderBalance(channelId);
    expect(mergeProviderBalances([notQueried(channelId)])[0].status).toBe('not_queried');
  });

  test('loadOverview after saveEdit does not resurrect the old account balance', () => {
    // Mirrors the Channels page flow: refresh → edit (forget) → loadOverview.
    // The overview returns not_queried (server cache was invalidated by the PUT)
    // and must NOT be replaced by the stale value that is still in the page signal.
    const channelId = 'ui-balance-edit-flow';
    mergeProviderBalances([okBalance(channelId, '42.10')]);
    forgetProviderBalance(channelId);
    const overview = mergeProviderBalances([notQueried(channelId)]);
    expect(overview[0].status).toBe('not_queried');
  });

  test('a remembered error cannot be resurrected for a channel edited since', () => {
    const channelId = 'ui-balance-edit-error';
    mergeProviderBalances([{
      channel_id: channelId,
      channel_name: 'DeepSeek',
      provider: 'deepseek',
      status: 'error',
      error: 'Transient failure',
    }]);
    forgetProviderBalance(channelId);
    expect(mergeProviderBalances([notQueried(channelId)])[0].status).toBe('not_queried');
  });
});
