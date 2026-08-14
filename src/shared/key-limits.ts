export const LIMIT_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type LimitPeriod = typeof LIMIT_PERIODS[number];

export function isLimitPeriod(value: unknown): value is LimitPeriod {
  return typeof value === 'string' && LIMIT_PERIODS.includes(value as LimitPeriod);
}

export interface QuotaWindow {
  period: LimitPeriod;
  startDate: string;
  endDate: string;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Return the half-open natural UTC calendar window containing `nowMs`. */
export function quotaWindow(period: LimitPeriod, nowMs: number = Date.now()): QuotaWindow {
  const now = new Date(nowMs);
  let start: Date;
  let end: Date;

  if (period === 'year') {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  } else if (period === 'month') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  } else if (period === 'week') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return { period, startDate: utcDate(start), endDate: utcDate(end) };
}
