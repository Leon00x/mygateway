import { Show } from 'solid-js';
import { PROVIDER_LOGO_GLYPHS } from '../provider-logos';

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
  return (
    <span
      class="provider-logo"
      classList={{ 'has-logo': Boolean(glyph()) }}
      style={glyph() ? { '--brand': glyph()!.hex } : undefined}
    >
      <Show when={glyph()} fallback={(props.name ?? '').slice(0, 1).toUpperCase()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={glyph()!.path} /></svg>
      </Show>
    </span>
  );
}
