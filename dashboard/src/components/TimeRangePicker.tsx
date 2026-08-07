/**
 * TimeRangePicker — modern SaaS-dashboard style range picker (QwenCloud-like).
 *
 * Trigger (440×56 pill) → Popover (760px, 28px radius):
 *   ModeTabs (segmented: Quick / Calendar)
 *   SelectedRange (grey bar showing resolved range)
 *   QuickRangeGrid (2×4 presets) | CalendarRangePicker (start/end date+time)
 *
 * Controlled component: value = { preset, start, end } in unix seconds.
 */

import { createSignal, For, Show } from 'solid-js';
import { t } from '../i18n';

export interface TimeRange {
  preset: string;
  start: number; // unix seconds
  end: number;   // unix seconds
}

export const QUICK_PRESETS = [
  '1h', '3h', '6h', '24h',
  'today', 'yesterday', '1w', 'custom',
] as const;

export type QuickPreset = typeof QUICK_PRESETS[number];

const PRESET_KEYS: Record<string, string> = {
  '1h': 'tr.1h', '3h': 'tr.3h', '6h': 'tr.6h', '24h': 'tr.24h',
  today: 'tr.today', yesterday: 'tr.yesterday', '1w': 'tr.1w', custom: 'tr.custom',
};

export function presetLabel(preset: string): string {
  return t(PRESET_KEYS[preset] ?? 'tr.custom');
}

/** Resolve a quick preset to [start, end] unix seconds (browser-local time). */
export function resolvePreset(preset: string, now: Date = new Date()): { start: number; end: number } {
  const ms = (d: Date) => Math.floor(d.getTime() / 1000);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case '1h': return { start: ms(new Date(now.getTime() - 3_600_000)), end: ms(now) };
    case '3h': return { start: ms(new Date(now.getTime() - 3 * 3_600_000)), end: ms(now) };
    case '6h': return { start: ms(new Date(now.getTime() - 6 * 3_600_000)), end: ms(now) };
    case '24h': return { start: ms(new Date(now.getTime() - 24 * 3_600_000)), end: ms(now) };
    case 'today': return { start: ms(day), end: ms(now) };
    case 'yesterday': {
      const y = new Date(day.getTime() - 86_400_000);
      return { start: ms(y), end: ms(new Date(day.getTime() - 1_000)) };
    }
    case '1w': return { start: ms(new Date(now.getTime() - 7 * 86_400_000)), end: ms(now) };
    default: return { start: ms(new Date(now.getTime() - 86_400_000)), end: ms(now) };
  }
}

/** YYYY-MM-DD HH:mm (browser-local). */
export function formatRangeLabel(start: number, end: number): string {
  const fmt = (ts: number) => {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return `${fmt(start)} ~ ${fmt(end)}`;
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ChevronIcon(props: { up: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.up ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

export default function TimeRangePicker(props: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [mode, setMode] = createSignal<'quick' | 'calendar'>('quick');
  // Calendar draft state (date/time strings)
  const [cStartDate, setCStartDate] = createSignal('');
  const [cStartTime, setCStartTime] = createSignal('00:00');
  const [cEndDate, setCEndDate] = createSignal('');
  const [cEndTime, setCEndTime] = createSignal('23:59');

  const nowValue = () => new Date();
  const label = () => props.value.preset === 'custom'
    ? formatRangeLabel(props.value.start, props.value.end)
    : presetLabel(props.value.preset);

  const pick = (preset: string) => {
    const { start, end } = resolvePreset(preset);
    props.onChange({ preset, start, end });
    if (preset === 'custom') {
      openCalendarDraft();
      setMode('calendar');
      setIsOpen(true);
    }
    // other presets keep the popover open per spec
  };

  const openCalendarDraft = () => {
    const s = new Date(props.value.start * 1000);
    const e = new Date(props.value.end * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    setCStartDate(`${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`);
    setCStartTime(`${p(s.getHours())}:${p(s.getMinutes())}`);
    setCEndDate(`${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`);
    setCEndTime(`${p(e.getHours())}:${p(e.getMinutes())}`);
  };

  const switchMode = (next: 'quick' | 'calendar') => {
    if (next === 'calendar' && cStartDate() === '') openCalendarDraft();
    setMode(next);
  };

  const applyCalendar = () => {
    if (!cStartDate() || !cEndDate()) return;
    const startTs = new Date(`${cStartDate()}T${cStartTime() || '00:00'}`).getTime();
    const endTs = new Date(`${cEndDate()}T${cEndTime() || '23:59'}`).getTime();
    if (isNaN(startTs) || isNaN(endTs) || startTs > endTs) return;
    props.onChange({
      preset: 'custom',
      start: Math.floor(startTs / 1000),
      end: Math.floor(endTs / 1000),
    });
    setIsOpen(false);
  };

  const cancelCalendar = () => setIsOpen(false);

  return (
    <div class="tr-picker">
      {/* Trigger */}
      <button
        type="button"
        class={`tr-trigger ${isOpen() ? 'tr-active' : ''}`}
        aria-haspopup="true"
        aria-expanded={isOpen()}
        onClick={() => setIsOpen(!isOpen())}
      >
        <span class="tr-trigger-icon"><CalendarIcon /></span>
        <span class="tr-trigger-label">{label()}</span>
        <span class="tr-trigger-chevron"><ChevronIcon up={isOpen()} /></span>
      </button>

      {/* Popover */}
      <Show when={isOpen()}>
        <div class="tr-backdrop" onClick={() => setIsOpen(false)} />
        <div class="tr-popover" role="dialog" onClick={(e) => e.stopPropagation()}>
          {/* Mode tabs (segmented) */}
          <div class="tr-tabs">
            <button
              type="button"
              class={`tr-tab ${mode() === 'quick' ? 'tr-tab-active' : ''}`}
              onClick={() => setMode('quick')}
            >
              {t('tr.quickSelect')}
            </button>
            <button
              type="button"
              class={`tr-tab ${mode() === 'calendar' ? 'tr-tab-active' : ''}`}
              onClick={() => switchMode('calendar')}
            >
              {t('tr.calendarSelect')}
            </button>
          </div>

          <Show when={mode() === 'quick'} fallback={
            /* Calendar mode: Start / End, each with date + time */
            <div class="tr-calendar">
              <div class="tr-range-bar">
                <span class="tr-range-bar-icon"><CalendarIcon /></span>
                <span class="tr-range-bar-text">{formatRangeLabel(props.value.start, props.value.end)}</span>
              </div>
              <div class="tr-calendar-grid">
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.startDate')}</span>
                  <input type="date" value={cStartDate()} max={cEndDate() || undefined} onInput={(e) => setCStartDate(e.currentTarget.value)} />
                </label>
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.startTime')}</span>
                  <input type="time" value={cStartTime()} onInput={(e) => setCStartTime(e.currentTarget.value)} />
                </label>
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.endDate')}</span>
                  <input type="date" value={cEndDate()} min={cStartDate() || undefined} onInput={(e) => setCEndDate(e.currentTarget.value)} />
                </label>
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.endTime')}</span>
                  <input type="time" value={cEndTime()} onInput={(e) => setCEndTime(e.currentTarget.value)} />
                </label>
              </div>
              <div class="tr-calendar-actions">
                <button type="button" class="tr-btn-secondary" onClick={cancelCalendar}>{t('common.cancel')}</button>
                <button type="button" class="tr-btn-primary" onClick={applyCalendar}>{t('common.confirm')}</button>
              </div>
            </div>
          }>
            {/* Selected range bar */}
            <div class="tr-range-bar">
              <span class="tr-range-bar-icon"><CalendarIcon /></span>
              <span class="tr-range-bar-text">{formatRangeLabel(props.value.start, props.value.end)}</span>
            </div>

            {/* Quick range grid: 2 rows × 4 cols */}
            <div class="tr-grid">
              <For each={QUICK_PRESETS}>{(preset) => (
                <button
                  type="button"
                  class={`tr-preset ${props.value.preset === preset ? 'tr-preset-active' : ''}`}
                  onClick={() => pick(preset)}
                >
                  {presetLabel(preset)}
                </button>
              )}</For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
