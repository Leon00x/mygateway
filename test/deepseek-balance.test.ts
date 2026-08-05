import { describe, expect, test, vi } from 'vitest';
import {
  fetchDeepSeekBalance,
  isOfficialDeepSeekChannel,
  parseDeepSeekBalance,
} from '../src/admin/provider-balances.ts';

describe('DeepSeek provider balance', () => {
  test('only recognizes the official DeepSeek API hostname', () => {
    expect(isOfficialDeepSeekChannel({
      base_url: 'https://api.deepseek.com/v1',
      protocols: [],
    })).toBe(true);
    expect(isOfficialDeepSeekChannel({
      base_url: 'https://proxy.example.com/v1',
      protocols: [{ base_url: 'https://api.deepseek.com/v1' }] as any,
    })).toBe(true);
    expect(isOfficialDeepSeekChannel({
      base_url: 'https://api.deepseek.com.evil.example/v1',
      protocols: [],
    })).toBe(false);
  });

  test('parses monetary strings without losing precision', () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '9007199254740993.01',
        granted_balance: '0.01',
        topped_up_balance: '9007199254740993.00',
      }],
    })).toEqual({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '9007199254740993.01',
        granted_balance: '0.01',
        topped_up_balance: '9007199254740993.00',
      }],
    });
  });

  test('normalizes an unstable upstream currency order to CNY before USD', () => {
    const parsed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '1.23', granted_balance: '0.00', topped_up_balance: '1.23' },
        { currency: 'CNY', total_balance: '88.36', granted_balance: '2.00', topped_up_balance: '86.36' },
      ],
    });
    expect(parsed.balance_infos.map((item) => item.currency)).toEqual(['CNY', 'USD']);
    // The reverse upstream order produces the same normalized array.
    const again = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '88.36', granted_balance: '2.00', topped_up_balance: '86.36' },
        { currency: 'USD', total_balance: '1.23', granted_balance: '0.00', topped_up_balance: '1.23' },
      ],
    });
    expect(again).toEqual(parsed);
  });

  test('rejects malformed amounts and unsupported currencies', () => {
    expect(() => parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{
        currency: 'EUR', total_balance: '1.00', granted_balance: '0', topped_up_balance: '1.00',
      }],
    })).toThrow('currency');
    expect(() => parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{
        currency: 'USD', total_balance: -1, granted_balance: '0', topped_up_balance: '0',
      }],
    })).toThrow('total_balance');
  });

  test('queries the exact official endpoint with Bearer authentication', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      is_available: false,
      balance_infos: [{
        currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await fetchDeepSeekBalance('ds-secret', fetcher as typeof fetch);

    expect(result.is_available).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/user/balance');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer ds-secret' }),
    });
  });

  test('does not expose an upstream error body', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('provider-secret-detail', { status: 401 }));
    await expect(fetchDeepSeekBalance('bad-key', fetcher as typeof fetch))
      .rejects.toThrow('DeepSeek balance request failed (HTTP 401)');
  });
});
