import { describe, expect, test } from 'vitest';
import { localizedChannelName, localizedPresetName } from '../dashboard/src/presets.ts';
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
});
