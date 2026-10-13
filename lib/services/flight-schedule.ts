// Check a read flight leg against the airline schedule (AeroDataBox, when AERODATABOX_RAPIDAPI_KEY is
// set). 13 Oct: KL879's boarding pass was read twice as "5 Oct" (13:05, then 09:24) although the
// pass says 10:05 / 13 Oct; the 23:10 arrival was right both times. When a leg's date comes out in
// the past (or undated), Gogo looks the flight number up for the nearby days and takes the occurrence
// whose scheduled departure or arrival clock matches what was read. Never guesses between two matches
// that are equally plausible, and leaves the leg unchanged when nothing matches.
const MIN = 60_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type ScheduleOccurrence = { depLocal: string; arrLocal: string; depUtc: number }

/** "2026-10-13 10:05+02:00" → { date: "13 Oct 2026", clock: "10:05" } */
export function localParts(local: string): { date: string; clock: string } | null {
  const m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return null
  return { date: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`, clock: `${m[4]}:${m[5]}` }
}

export function occurrencesFrom(json: any): ScheduleOccurrence[] {
  return (Array.isArray(json) ? json : []).map((f: any) => ({
    depLocal: String(f?.departure?.scheduledTime?.local || ''),
    arrLocal: String(f?.arrival?.scheduledTime?.local || ''),
    depUtc: Date.parse(String(f?.departure?.scheduledTime?.utc || '').replace(' ', 'T')),
  })).filter(o => o.depLocal && Number.isFinite(o.depUtc))
}

/** The occurrence matching the read clocks, nearest upcoming first; null when none or ambiguous. */
export function pickOccurrence(list: ScheduleOccurrence[], read: { departure?: string; arrival?: string }, now: number): ScheduleOccurrence | null {
  const clock = (s?: string) => String(s || '').trim().padStart(5, '0')
  const hits = list.filter(o => {
    const d = localParts(o.depLocal)?.clock, a = localParts(o.arrLocal)?.clock
    return (read.departure && d === clock(read.departure)) || (read.arrival && a === clock(read.arrival))
  }).filter(o => o.depUtc > now - 12 * 60 * MIN)
  if (!hits.length) return null
  hits.sort((x, y) => x.depUtc - y.depUtc)
  return hits[0]
}

async function lookup(flightNo: string, ymd: string): Promise<ScheduleOccurrence[]> {
  const key = process.env.AERODATABOX_RAPIDAPI_KEY
  if (!key) return []
  const code = String(flightNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z0-9]{2})0+(\d)/, '$1$2')
  const res = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(code)}/${ymd}?withAircraftImage=false&withLocation=false`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }, signal: AbortSignal.timeout(8_000),
  })
  if (res.status === 204) return []
  if (!res.ok) { console.error('FLIGHT_SCHEDULE_LOOKUP_FAILED:', res.status); return [] }
  return occurrencesFrom(await res.json().catch(() => null))
}

/**
 * Correct a leg's date and clocks from the schedule when it reads as past/undated.
 * Returns the corrected leg (with scheduleChecked: true) or the original.
 */
export async function scheduleCheckedLeg<T extends { flightNo?: string; date?: string; departure?: string; arrival?: string; arrivalDate?: string }>(
  f: T, departAt: Date | null, now: number, timezone: string | null,
): Promise<T & { scheduleChecked?: boolean }> {
  if (!process.env.AERODATABOX_RAPIDAPI_KEY || !f.flightNo) return f
  if (departAt && departAt.getTime() > now - 12 * 60 * MIN) return f
  const tz = timezone || 'UTC'
  const ymd = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
  const days = [...new Set([ymd(now), ymd(now + 24 * 60 * MIN)])]
  try {
    const list = (await Promise.all(days.map(d => lookup(f.flightNo!, d)))).flat()
    const hit = pickOccurrence(list, f, now)
    if (!hit) return f
    const dep = localParts(hit.depLocal)!, arr = localParts(hit.arrLocal)
    console.log('FLIGHT_SCHEDULE_CORRECTED:', JSON.stringify({ flight: f.flightNo, from: `${f.date} ${f.departure}`, to: `${dep.date} ${dep.clock}` }))
    return { ...f, date: dep.date, departure: dep.clock, ...(arr ? { arrival: arr.clock, arrivalDate: arr.date } : {}), scheduleChecked: true }
  } catch (err: any) {
    console.error('FLIGHT_SCHEDULE_CHECK_FAILED:', String(err?.message || err).slice(0, 120))
    return f
  }
}
