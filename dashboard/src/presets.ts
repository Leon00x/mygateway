export {
  PROVIDER_PRESETS,
  COMMON_MODEL_TEMPLATES,
  type ProviderPreset,
} from '../../src/shared/provider-presets.ts';

import {
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '../../src/shared/provider-presets.ts';

export type ProviderLocale = 'zh' | 'en';

export function localizedPresetName(preset: ProviderPreset, locale: ProviderLocale): string {
  return locale === 'zh' ? (preset.name_zh ?? preset.name) : preset.name;
}

/**
 * Localize preset defaults while preserving names explicitly customized by
 * the administrator. Both old Chinese defaults and new canonical English
 * defaults are recognized so existing D1 rows need no migration.
 */
export function localizedChannelName(
  name: string,
  presetId: string | null | undefined,
  locale: ProviderLocale,
): string {
  const preset = presetId ? PROVIDER_PRESETS.find((item) => item.id === presetId) : undefined;
  if (!preset) return name;
  const isPresetDefault = name === preset.name || (preset.name_zh !== undefined && name === preset.name_zh);
  return isPresetDefault ? localizedPresetName(preset, locale) : name;
}
