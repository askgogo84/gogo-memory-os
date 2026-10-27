// 27 Oct live: Google ignored the prose q= search for BLR to BOM, the form stayed blank and the planner looped on
// trip type and date until the deadline. The browser now opens Google's own encoded search (tfs).
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
const { googleFlightsTfsUrl } = await import('../lib/agent/travel-browser-task.ts')
const tfs = (c: any) => new URL(googleFlightsTfsUrl(c)!).searchParams.get('tfs')
// Byte-identical to a real Google Flights one-way URL (TPE to MYJ, 28 May 2024, 1 adult, economy).
assert.equal(tfs({ origin: { code: 'TPE' }, destination: { code: 'MYJ' }, startDate: '2024-05-28', adults: 1, cabin: 'economy' }), 'CBwQAhoeEgoyMDI0LTA1LTI4agcIARIDVFBFcgcIARIDTVlKQAFIAXABggELCP___________wGYAQI')
const decode = (s: string) => [...atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4))].map(c => c.charCodeAt(0))
const round = decode(tfs({ origin: { code: 'BLR' }, destination: { code: 'SIN' }, startDate: '2026-11-28', returnDate: '2026-12-02', roundTrip: true, adults: 2, cabin: 'business' })!)
const txt = String.fromCharCode(...round)
assert.ok(txt.includes('2026-11-28') && txt.includes('2026-12-02') && txt.indexOf('BLR') < txt.indexOf('SIN'), 'two legs, outbound first')
assert.equal(round.filter((b, i) => b === 0x40 && round[i + 1] === 1).length, 2, 'two adults')
assert.deepEqual(round.slice(-3), [0x98, 0x01, 0x01], 'round trip')
assert.ok(txt.includes('H\x03'), 'business cabin')
assert.equal(googleFlightsTfsUrl({ origin: { code: 'Bangalore' }, destination: { code: 'BOM' }, startDate: '2026-11-08' } as any), null, 'bad codes fall back to the q= link')
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/travel-browser-task.ts', import.meta.url), 'utf8')
assert.ok(src.includes('const url = tfsUrl ||'), 'browser starts from the encoded search')
assert.ok(src.includes('Never re-click the trip type'), 'planner told not to loop on trip type')
console.log('FLIGHT_TFS_OK')
