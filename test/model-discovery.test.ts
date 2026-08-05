import { describe, expect, test, vi } from 'vitest';
import {
  discoverProviderModels,
  normalizeModelIdentifier,
  parseProviderModelList,
} from '../src/admin/model-discovery.ts';

describe('provider model discovery', () => {
  test('parses OpenAI-compatible model lists and removes duplicates', () => {
    expect(parseProviderModelList({ data: [
      { id: 'deepseek-chat', display_name: 'DeepSeek Chat' },
      { id: 'deepseek-chat' },
      { id: 'legacy', capabilities: { completion_chat: false } },
    ] }).models).toEqual([{
      id: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: undefined,
    }]);
  });

  test('parses Gemini-style names and page tokens', () => {
    const parsed = parseProviderModelList({
      models: [{ name: 'models/gemini-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] }],
      nextPageToken: 'next',
    });
    expect(parsed.models[0]).toMatchObject({ id: 'gemini-flash', displayName: 'Gemini Flash' });
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextPageToken).toBe('next');
  });

  test('parses Anthropic cursors and normalizes editable unified ids', () => {
    const parsed = parseProviderModelList({ data: [{ id: 'claude-sonnet-4-5' }], has_more: true, last_id: 'm_1' });
    expect(parsed.lastId).toBe('m_1');
    expect(normalizeModelIdentifier(' DeepSeek V4 Flash! ')).toBe('DeepSeek-V4-Flash');
  });

  test('rejects unsupported response shapes', () => {
    expect(() => parseProviderModelList({ items: [] })).toThrow(/unsupported response shape/);
  });

  test('preflight discovery uses the model-list protocol without persistence', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.deepseek.com/v1/models');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provider-test-key');
      return new Response(JSON.stringify({ data: [
        { id: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro' },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const models = await discoverProviderModels({
        preset_id: 'deepseek',
        protocols: [
          { protocol: 'anthropic_messages', base_url: 'https://api.deepseek.com/anthropic', auth_scheme: 'x_api_key', api_version: '2023-06-01' },
          { protocol: 'openai_chat', base_url: 'https://api.deepseek.com/v1', auth_scheme: 'bearer', api_version: null },
        ],
      }, 'provider-test-key');
      expect(models.map((model) => model.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
