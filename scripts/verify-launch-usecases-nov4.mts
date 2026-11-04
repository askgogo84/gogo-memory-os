// Launch retest fixes (4 Nov): live findings from the dashboard, each pinned here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'

// 1. "did EK 569 land today?" answered with a 1 Nov landing. Undated status questions only accept yesterday..tomorrow.
{
  const { classifyOccurrence } = await import('../lib/bot/handlers/flight-status')
  const ref = '2026-11-03'
  const stale = { title: 'EK569 Flight Status', snippet: 'Landed 06:50 (+04) on 01-Nov-2026, gate arrival 06:54', url: 'https://www.flightaware.com/live/flight/UAE569' }
  assert.deepEqual(classifyOccurrence(stale, 'did EK 569 land today?', ref), { usable: false, reason: 'date_contradiction' }, '"today" vs 1 Nov')
  const { normalizeNumericDates } = await import('../lib/bot/flight-codes')
  assert.equal(normalizeNumericDates('landed on 01-Nov-2026 and 3-nov-26'), 'landed on 1 Nov 2026 and 3 Nov 2026')
  assert.deepEqual(classifyOccurrence(stale, 'did EK 569 land?', ref), { usable: false, reason: 'stale_date' })
  const today = { ...stale, snippet: 'Landed 06:50 (+04) on 03-Nov-2026' }
  assert.equal(classifyOccurrence(today, 'did EK 569 land?', ref).usable, true)
  const overnight = { ...stale, snippet: 'Departed 02 Nov 2026 23:40, landed 06:50' }
  assert.equal(classifyOccurrence(overnight, 'did EK 569 land?', ref).usable, true, 'an overnight flight from yesterday still counts')
  const staleUrl = { title: 'EK569', snippet: 'Landed 06:50', url: 'https://www.flightaware.com/live/flight/UAE569/history/20261101/0030Z/VOBL/OMDB' }
  assert.deepEqual(classifyOccurrence(staleUrl, 'did EK 569 land?', ref), { usable: false, reason: 'stale_date' })
  const undated = { title: 'EK569 Flight Status', snippet: 'Track Emirates 569 live', url: 'https://www.flightaware.com/live/flight/UAE569' }
  assert.equal(classifyOccurrence(undated, 'did EK 569 land?', ref).usable, true, 'undated pages are left to the existing checks')
  assert.equal(classifyOccurrence(stale, 'did EK 569 land on 1 Nov 2026?', ref).usable, true, 'asking about 1 Nov still gets 1 Nov')
  console.log('✓ flight status: results from another day are dropped unless that day was asked for')
}

// 2. One question looked the flight up twice (brain + status handler). Same live lookup within a minute is shared.
{
  const src = readFileSync('lib/agent/flight-track.ts', 'utf8')
  assert.match(src, /const LIVE_TTL_MS = 60_000/)
  assert.match(src, /if \(fetcher !== fetchAeroDataBox \|\| opts\.search \|\| opts\.crossCheck === false\) return lookupLiveFlightUncached/, 'tests with fake feeds are never cached')
  console.log('✓ flight status: one live-feed lookup per flight per minute')
}
console.log('Launch use-case checks passed')
