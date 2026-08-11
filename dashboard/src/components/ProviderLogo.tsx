import { Show } from 'solid-js';
import { PROVIDER_LOGO_GLYPHS } from '../provider-logos';

const PROVIDER_MONOGRAMS: Record<string, { label: string; color: string; background: string }> = {
  zai: { label: 'Z', color: '#155EEF', background: '#EEF4FF' },
  byteplus_modelark: { label: 'B+', color: '#5B21B6', background: '#F3EFFF' },
  groq: { label: 'G', color: '#F55036', background: '#FFF1EE' },
  xai: { label: 'x', color: '#111827', background: '#F2F3F5' },
  mistral: { label: 'M', color: '#E95420', background: '#FFF2E8' },
  siliconflow: { label: 'SF', color: '#5B45E0', background: '#F0EEFF' },
  zhipu: { label: '智', color: '#245BDB', background: '#EDF3FF' },
};

/**
 * Provider tile: renders the brand glyph (Simple Icons, bundled) when the
 * preset has one, otherwise falls back to the current letter monogram.
 */
export function ProviderLogo(props: {
  /** Channel preset id (channel.preset_id / preset.id). */
  presetId?: string | null;
  /** Channel or preset name used for the monogram fallback. */
  name?: string;
}) {
  const glyph = () => (props.presetId ? PROVIDER_LOGO_GLYPHS[props.presetId] : undefined);
  const monogram = () => (props.presetId ? PROVIDER_MONOGRAMS[props.presetId] : undefined);
  return (
    <span class="provider-logo" classList={{ 'has-logo': Boolean(glyph()) }} style={glyph() ? { '--brand': glyph()!.hex } : monogram() ? { color: monogram()!.color, background: monogram()!.background } : undefined}>
      <Show when={glyph()} fallback={monogram()?.label ?? (props.name ?? '').slice(0, 1).toUpperCase()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={glyph()!.path} />
        </svg>
      </Show>
    </span>
  );
}
