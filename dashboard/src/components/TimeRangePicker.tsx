/**
 * Compact dashboard time-range picker.
 *
 * Trigger → responsive popover:
 *   ModeTabs (segmented: Quick / Calendar)
 *   SelectedRange (grey bar showing resolved range)
 *   QuickRangeGrid (2×4 presets) | CalendarRangePicker (start/end date+time)
 *
 * Controlled component: value = { preset, start, end } in unix seconds.
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { locale, t } from '../i18n';

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

function localDateKey(date: Date): string {
  const p = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function dateFromKey(key: string): Date | null {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export default function TimeRangePicker(props: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [mode, setMode] = createSignal<'quick' | 'calendar'>('quick');
  // Calendar draft state. Dates are chosen from the calendar; only times remain editable fields.
  const [cStartDate, setCStartDate] = createSignal('');
  const [cStartTime, setCStartTime] = createSignal('00:00');
  const [cEndDate, setCEndDate] = createSignal('');
  const [cEndTime, setCEndTime] = createSignal('23:59');
  const [calendarCursor, setCalendarCursor] = createSignal(new Date());
  const [rangePhase, setRangePhase] = createSignal<'start' | 'end' | 'complete'>('complete');

  const nowValue = () => new Date();
  const label = () => props.value.preset === 'custom'
    ? formatRangeLabel(props.value.start, props.value.end)
    : presetLabel(props.value.preset);

  const pick = (preset: string) => {
    if (preset === 'custom') {
      openCalendarDraft();
      setMode('calendar');
      setIsOpen(true);
      return;
    }
    const { start, end } = resolvePreset(preset);
    props.onChange({ preset, start, end });
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
    setCalendarCursor(new Date(s.getFullYear(), s.getMonth(), 1));
    setRangePhase('complete');
  };

  const monthLabel = () => new Intl.DateTimeFormat(locale() === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'long',
  }).format(calendarCursor());

  const weekdayLabels = createMemo(() => {
    const language = locale() === 'zh' ? 'zh-CN' : 'en-US';
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: 'short' })
      .format(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
  });

  const calendarDays = createMemo(() => {
    const cursor = calendarCursor();
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      return { date, key: localDateKey(date), currentMonth: date.getMonth() === cursor.getMonth() };
    });
  });

  const moveMonth = (delta: number) => {
    const cursor = calendarCursor();
    setCalendarCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };

  const chooseDate = (key: string) => {
    if (rangePhase() !== 'end') {
      setCStartDate(key);
      setCEndDate('');
      setRangePhase('end');
      return;
    }
    if (key < cStartDate()) {
      setCStartDate(key);
      setCEndDate('');
      return;
    }
    setCEndDate(key);
    setRangePhase('complete');
  };

  const draftRangeLabel = () => {
    const language = locale() === 'zh' ? 'zh-CN' : 'en-US';
    const format = (key: string) => {
      const date = dateFromKey(key);
      return date ? new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }).format(date) : '—';
    };
    return `${format(cStartDate())}  →  ${format(cEndDate())}`;
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
        aria-label={`${t('common.timeRange')}: ${label()}`}
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
            /* Calendar mode: click dates to build a range; time remains optional precision. */
            <div class="tr-calendar">
              <div class="tr-range-bar">
                <span class="tr-range-bar-icon"><CalendarIcon /></span>
                <span class="tr-range-bar-text">{draftRangeLabel()}</span>
              </div>
              <div class="tr-calendar-picker">
                <div class="tr-calendar-head">
                  <button type="button" aria-label={t('tr.previousMonth')} onClick={() => moveMonth(-1)}>‹</button>
                  <strong>{monthLabel()}</strong>
                  <button type="button" aria-label={t('tr.nextMonth')} onClick={() => moveMonth(1)}>›</button>
                </div>
                <div class="tr-weekdays"><For each={weekdayLabels()}>{(day) => <span>{day}</span>}</For></div>
                <div class="tr-days"><For each={calendarDays()}>{(day) => (
                  <button
                    type="button"
                    classList={{
                      'outside': !day.currentMonth,
                      'in-range': Boolean(cStartDate() && cEndDate() && day.key > cStartDate() && day.key < cEndDate()),
                      'range-edge': day.key === cStartDate() || day.key === cEndDate(),
                      'today': day.key === localDateKey(new Date()),
                    }}
                    aria-label={day.key}
                    onClick={() => chooseDate(day.key)}
                  >{day.date.getDate()}</button>
                )}</For></div>
                <p class="tr-calendar-guide">{rangePhase() === 'end' ? t('tr.chooseEnd') : t('tr.chooseStart')}</p>
              </div>
              <div class="tr-calendar-times">
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.startTime')}</span>
                  <input type="time" value={cStartTime()} onInput={(e) => setCStartTime(e.currentTarget.value)} />
                </label>
                <label class="tr-calendar-field">
                  <span class="tr-calendar-label">{t('tr.endTime')}</span>
                  <input type="time" value={cEndTime()} onInput={(e) => setCEndTime(e.currentTarget.value)} />
                </label>
              </div>
              <div class="tr-calendar-actions">
                <button type="button" class="tr-btn-secondary" onClick={cancelCalendar}>{t('common.cancel')}</button>
                <button type="button" class="tr-btn-primary" disabled={!cStartDate() || !cEndDate()} onClick={applyCalendar}>{t('common.confirm')}</button>
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
