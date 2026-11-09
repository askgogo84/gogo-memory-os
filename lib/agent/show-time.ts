// Show-time guard (8 Nov live): a 10:00 PM PVR show got its "starts in 2 hours" reminder at 2:30 PM. The extractor had
// written the UTC clock with an IST offset (16:30+05:30), shifting the instant 5½ hours early. The ticket's own printed
// clock is the truth: if the instant's local clock disagrees with it but the instant moved by the zone offset agrees,
// use that. Pure.

/** Minutes past midnight for every clock printed in the text ("10:00 PM", "22:00", "10 pm"). */
export function clocksIn(text: string): number[] {
  const out = new Set<number>()
  for (const m of String(text || '').matchAll(/\b(\d{1,2})(?::|\.)(\d{2})\s*([ap])\.?\s*m\b/gi)) { const h = +m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0); if (+m[1] <= 12 && +m[2] < 60) out.add(h * 60 + +m[2]) }
  for (const m of String(text || '').matchAll(/\b(\d{1,2})\s*([ap])\.?\s*m\b/gi)) { if (+m[1] >= 1 && +m[1] <= 12) out.add((+m[1] % 12 + (/p/i.test(m[2]) ? 12 : 0)) * 60) }
  for (const m of String(text || '').matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?\s*m)/gi)) out.add(+m[1] * 60 + +m[2])
  return [...out]
}

/** Local clock (minutes past midnight) of an instant in a time zone, and that zone's offset at the instant, in minutes. */
export function localClock(ms: number, tz: string): { minutes: number; offset: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return { minutes: +p.hour * 60 + +p.minute, offset: Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000) }
}

/** The start instant, corrected when it is exactly one zone-offset away from the clock printed on the ticket. */
export function reconcileShowTime(startIso: string | null, evidence: string, tz: string): { startAt: string | null; corrected: boolean } {
  if (!startIso) return { startAt: null, corrected: false }
  const ms = Date.parse(startIso); if (!Number.isFinite(ms)) return { startAt: null, corrected: false }
  const clocks = clocksIn(evidence); if (!clocks.length) return { startAt: startIso, corrected: false }
  const { minutes, offset } = localClock(ms, tz)
  if (!offset || clocks.includes(minutes)) return { startAt: startIso, corrected: false }
  for (const shifted of [ms + offset * 60_000, ms - offset * 60_000]) {
    if (clocks.includes(localClock(shifted, tz).minutes)) return { startAt: new Date(shifted).toISOString(), corrected: true }
  }
  return { startAt: startIso, corrected: false }
}
