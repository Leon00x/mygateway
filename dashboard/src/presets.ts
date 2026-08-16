export {
  PROVIDER_PRESETS,
  COMMON_MODEL_TEMPLATES,
  type ProviderPreset,
} from '../../src/shared/provider-presets.ts';

import {
  PROVIDER_PRESETS,
  inferProviderPresetId,
  type ProviderPreset,
} from '../../src/shared/provider-presets.ts';

export type ProviderLocale = 'zh' | 'en';

export function localizedPresetName(preset: ProviderPreset, locale: ProviderLocale): string {
  return locale === 'zh' ? (preset.name_zh ?? preset.name) : preset.name;
}

/** Use persisted identity first; safely recognize legacy custom-created channels by official API hosts. */
export function resolvedChannelPresetId(channel: {
  preset_id?: string | null;
  protocols?: Array<{ protocol: string; base_url: string }>;
}): string | null {
  return channel.preset_id || inferProviderPresetId(channel.protocols ?? []);
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
