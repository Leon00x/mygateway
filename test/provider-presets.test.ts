import { describe, expect, test } from 'vitest';
import {
  COMMON_MODEL_TEMPLATES,
  getPresetById,
  providerModelDiscovery,
  providerShortCode,
  PROVIDER_PRESETS,
} from '../src/shared/provider-presets.ts';

describe('provider presets', () => {
  test('use unique ids and normalized HTTPS URLs', () => {
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length);

    for (const preset of PROVIDER_PRESETS) {
      expect(new URL(preset.base_url).protocol).toBe('https:');
      expect(new URL(preset.docs_url).protocol).toBe('https:');
      expect(preset.base_url.endsWith('/')).toBe(false);
      expect(preset.protocols.length).toBeGreaterThan(0);
      expect(new Set(preset.protocols.map((item) => item.protocol)).size).toBe(preset.protocols.length);

      for (const protocol of preset.protocols) {
        expect(new URL(protocol.base_url).protocol).toBe('https:');
        expect(protocol.base_url.endsWith('/')).toBe(false);
      }
    }
  });

  test('includes the requested providers', () => {
    expect(['deepseek', 'zai', 'huawei_cloud_cn', 'alibaba_cloud_intl', 'byteplus_modelark']
      .map((id) => getPresetById(id)?.name)).toEqual([
        'DeepSeek',
        'Z.AI',
        '华为云（中国）',
        '阿里云国际',
        '火山国际（BytePlus）',
      ]);
  });

  test('includes the international provider batch', () => {
    expect(['google_gemini', 'groq', 'minimax_intl', 'xai', 'mistral']
      .map((id) => getPresetById(id)?.name)).toEqual([
        'Google Gemini',
        'Groq',
        'MiniMax 国际',
        'xAI',
        'Mistral AI',
      ]);
  });

  test('configures only documented native protocols for new presets', () => {
    const protocols = (id: string) => getPresetById(id)?.protocols.map((item) => item.protocol);

    expect(protocols('deepseek')).toEqual(['openai_chat', 'anthropic_messages']);
    expect(protocols('zai')).toEqual(['openai_chat']);
    expect(protocols('huawei_cloud_cn')).toEqual(['openai_chat', 'anthropic_messages']);
    expect(protocols('alibaba_cloud_intl')).toEqual(['openai_chat', 'anthropic_messages']);
    expect(protocols('byteplus_modelark')).toEqual(['openai_chat', 'openai_responses']);
    expect(protocols('google_gemini')).toEqual(['openai_chat']);
    expect(protocols('groq')).toEqual(['openai_chat', 'openai_responses']);
    expect(protocols('minimax_intl')).toEqual(['openai_chat', 'anthropic_messages']);
    expect(protocols('xai')).toEqual(['openai_chat', 'openai_responses']);
    expect(protocols('mistral')).toEqual(['openai_chat']);
  });

  test('uses the correct endpoint parents and authentication', () => {
    expect(getPresetById('deepseek')?.protocols[1]).toMatchObject({
      protocol: 'anthropic_messages',
      base_url: 'https://api.deepseek.com/anthropic',
      auth_scheme: 'x_api_key',
    });
    expect(getPresetById('huawei_cloud_cn')?.protocols[1]).toMatchObject({
      base_url: 'https://api.modelarts-maas.com/anthropic/v1',
      auth_scheme: 'x_api_key',
    });
    expect(getPresetById('alibaba_cloud_intl')?.protocols[1]).toMatchObject({
      base_url: 'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1',
      auth_scheme: 'x_api_key',
    });
    expect(getPresetById('minimax_intl')?.protocols[1]).toMatchObject({
      base_url: 'https://api.minimax.io/anthropic/v1',
      auth_scheme: 'x_api_key',
    });
    expect(getPresetById('google_gemini')?.protocols[0]).toMatchObject({
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      auth_scheme: 'bearer',
    });
    expect(getPresetById('groq')?.protocols[1]).toMatchObject({
      protocol: 'openai_responses',
      base_url: 'https://api.groq.com/openai/v1',
    });
    expect(getPresetById('xai')?.protocols[1]).toMatchObject({
      protocol: 'openai_responses',
      base_url: 'https://api.x.ai/v1',
    });
    expect(getPresetById('mistral')?.protocols[0]).toMatchObject({
      base_url: 'https://api.mistral.ai/v1',
      auth_scheme: 'bearer',
    });
  });

  test('provides bounded common templates and documented discovery exceptions', () => {
    expect(COMMON_MODEL_TEMPLATES).toHaveLength(30);
    expect(new Set(COMMON_MODEL_TEMPLATES).size).toBe(30);
    expect(providerModelDiscovery('deepseek')).toEqual({
      path: '/models', protocol: 'openai_chat', pagination: 'none',
    });
    expect(providerModelDiscovery('anthropic')).toEqual({
      path: '/models', protocol: 'anthropic_messages', pagination: 'anthropic_cursor',
    });
    expect(providerModelDiscovery('huawei_cloud_cn')).toEqual({
      path: '/models', base_url: 'https://api.modelarts-maas.com/v1',
      protocol: 'openai_chat', pagination: 'none',
    });
    expect(providerShortCode('deepseek')).toBe('ds');
    expect(providerShortCode(null, 'Internal Gateway')).toBe('intern');
  });
});
