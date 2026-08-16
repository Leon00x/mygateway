import { describe, expect, test } from 'vitest';
import { localizedChannelName, localizedPresetName, resolvedChannelPresetId } from '../dashboard/src/presets.ts';
import { getPresetById } from '../src/shared/provider-presets.ts';

describe('provider name localization', () => {
  test('shows preset names in the active locale', () => {
    const huawei = getPresetById('huawei_cloud_cn')!;
    expect(localizedPresetName(huawei, 'zh')).toBe('华为云（中国）');
    expect(localizedPresetName(huawei, 'en')).toBe('Huawei Cloud (China)');
  });

  test('localizes existing Chinese and new English preset defaults', () => {
    expect(localizedChannelName('华为云（中国）', 'huawei_cloud_cn', 'en')).toBe('Huawei Cloud (China)');
    expect(localizedChannelName('Huawei Cloud (China)', 'huawei_cloud_cn', 'zh')).toBe('华为云（中国）');
  });

  test('does not translate administrator-defined channel names', () => {
    expect(localizedChannelName('Production CN route', 'huawei_cloud_cn', 'zh')).toBe('Production CN route');
    expect(localizedChannelName('内部代理', null, 'en')).toBe('内部代理');
  });

  test('recovers the provider identity of legacy custom channels from an official API host', () => {
    expect(resolvedChannelPresetId({
      preset_id: null,
      protocols: [{ protocol: 'openai_chat', base_url: 'https://api.deepseek.com/v1' }],
    })).toBe('deepseek');
    expect(resolvedChannelPresetId({
      preset_id: null,
      protocols: [{ protocol: 'openai_chat', base_url: 'https://gateway.internal.example/v1' }],
    })).toBeNull();
  });
});
