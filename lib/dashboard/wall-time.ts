// Zero-import wall-clock ↔ UTC helpers (Phase 6). No imports (Intl and Date are
// globals), so Node's native type-stripping loads this directly under `node --test`.
// Used by the reminder edit route to convert the user's chosen wall-clock time to a
// UTC instant under their AUTHORITATIVE stored timezone — never a client-supplied zone.

// The offset (ms) of `tz` from UTC at instant `at`. Derived by asking Intl what wall
// time `at` shows in `tz`, then diffing that against `at` itself.
export function zoneOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - at.getTime()
}

// Today's Y/M/D as seen in `tz` (the Today thread only edits today's reminders).
export function todayInTz(tz: string, now: Date = new Date()): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { y: get('year'), mo: get('month'), d: get('day') }
}

// A wall-clock (y, mo, d, hh, mm) in `tz` → the UTC instant, as an ISO string. India
// has no DST, so the single-pass offset resolution is exact for our users; it is also
// correct for any non-DST zone and off by at most the transition hour on the two DST
// switch days elsewhere.
export function wallTimeToUtcIso(tz: string, y: number, mo: number, d: number, hh: number, mm: number): string {
  const utcGuess = Date.UTC(y, mo - 1, d, hh, mm, 0)
  const offset = zoneOffsetMs(tz, new Date(utcGuess))
  return new Date(utcGuess - offset).toISOString()
}
