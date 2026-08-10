/**
 * Per-model price editor used in the channel-add preflight list.
 * Values are displayed in $/M or ¥/M; stored as micros on submit.
 */

import { t } from '../i18n';

export interface PriceInput {
  input: string;
  output: string;
  cache: string;
  currency: 'USD' | 'CNY';
}

export const emptyPrice = (currency: 'USD' | 'CNY' = 'USD'): PriceInput => ({
  input: '', output: '', cache: '', currency,
});

export function priceInputFromMicros(
  input: number | null,
  output: number | null,
  cache: number | null,
  currency: string = 'USD',
): PriceInput {
  const fmt = (v: number | null) => (v === null || v === 0 ? '' : String(v / 1_000_000));
  return { input: fmt(input), output: fmt(output), cache: fmt(cache), currency: currency === 'CNY' ? 'CNY' : 'USD' };
}

export function microsFromDollars(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : null;
}

export default function PriceFields(props: {
  value: PriceInput;
  onChange: (next: PriceInput) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<PriceInput>) => props.onChange({ ...props.value, ...patch });
  return (
    <span class={`price-fields ${props.compact ? 'price-fields-compact' : ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <span class="price-field"><small>{t('prices.input')}</small><input type="number" min="0" step="0.01" placeholder="—" value={props.value.input} onInput={(e) => set({ input: e.currentTarget.value })} /></span>
      <span class="price-field"><small>{t('prices.output')}</small><input type="number" min="0" step="0.01" placeholder="—" value={props.value.output} onInput={(e) => set({ output: e.currentTarget.value })} /></span>
      <span class="price-field"><small>{t('prices.cache')}</small><input type="number" min="0" step="0.01" placeholder="—" value={props.value.cache} onInput={(e) => set({ cache: e.currentTarget.value })} /></span>
      <span class="price-field price-field-currency"><small>{t('prices.currency')}</small><select value={props.value.currency} onChange={(e) => set({ currency: e.currentTarget.value as 'USD' | 'CNY' })}><option value="USD">USD</option><option value="CNY">CNY</option></select></span>
    </span>
  );
}
