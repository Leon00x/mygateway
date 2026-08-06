/**
 * Usage statistics database operations.
 */

/**
 * Get time range boundaries in minute-precision Unix seconds.
 */
export function getUsageRange(
  range: 'today' | '7d' | '30d',
  timeZone = 'Asia/Shanghai',
  now = Date.now(),
): { start: number; end: number } {
  // End is the NEXT minute boundary so the current minute is included
  // (usage rows use minute-truncated timestamps == floor(now/60s)*60).
  const endMinute = Math.floor(now / 60_000) * 60 + 60;
  let startMinute: number;

  if (range === 'today') {
    startMinute = Math.floor(startOfDayInTimeZone(now, timeZone) / 60_000) * 60;
  } else if (range === '7d') {
    startMinute = Math.floor((now - 7 * 86_400_000) / 60_000) * 60;
  } else {
    startMinute = Math.floor((now - 30 * 86_400_000) / 60_000) * 60;
  }

  return { start: startMinute, end: endMinute };
}

function zonedParts(timestampMs: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Resolve local midnight to UTC, including time zones with DST transitions. */
function startOfDayInTimeZone(nowMs: number, timeZone: string): number {
  const local = zonedParts(nowMs, timeZone);
  const targetAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  let candidate = targetAsUtc;

  // Re-evaluate the offset because it can differ across a DST boundary.
  for (let i = 0; i < 3; i++) {
    const observed = zonedParts(candidate, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const next = candidate + (targetAsUtc - observedAsUtc);
    if (next === candidate) break;
    candidate = next;
  }

  return candidate;
}

export async function cleanupOldUsage(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  const cutoff = Math.floor((Date.now() - retentionDays * 86_400_000) / 60_000) * 60;
  const result = await db
    .prepare('DELETE FROM usage_minutes WHERE timestamp_minute < ?')
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
