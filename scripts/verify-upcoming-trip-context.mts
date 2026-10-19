// 19 Oct live: "What should I watch for my upcoming trip?" listed another traveller's
// past KLM legs (5 and 13 Oct) from saved memories as the owner's upcoming itinerary.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://context-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fixture-only'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fixture-only'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fixture-only'
const {prioritizeRecallEvidence} = await import('../lib/agent/context-brain')

const RealDate = Date
const NOW = RealDate.parse('2026-10-19T04:30:00Z')
;(globalThis as any).Date = class extends RealDate {
  constructor(...args: any[]) { super(...(args.length ? args : [NOW]) as []) }
  static now() { return NOW }
}

const fact = (id: string, summary: string, source = 'semantic_memory') => ({id, source, summary, kind: 'memory', sourceRefs: []}) as any
const pastKlm = fact('klm-13', 'Divyashree Urs arrives Bengaluru on KL0879 from Amsterdam on 13 Oct 2026 at 13:35 IST')
const pastKlm5 = fact('klm-5', 'KL0879 flight Amsterdam to Bengaluru arrival 5 October')
const futureFlight = fact('goa', 'Flight BLR to GOI on 2 Nov 2026, departure 07:10')
const undated = fact('pref', 'Prefers aisle seats on flights')
const move = fact('move', 'Moving house on 25 October 2026')
const ticket = fact('ticket', 'Flight AMS → BLR · STATUS: scheduled arrival time is already in the past', 'travel_ticket')

const failures: string[] = []
function check(label: string, fn: () => void) { try { fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(label + ': ' + e.message) } }

check('an upcoming-trip question drops saved flight memories whose every date has passed', () => {
  for (const q of ['What should I watch for my upcoming trip? Read-only; do not create anything.', 'Review what you reasonably can for my next trip', 'Anything I need for my trip?']) {
    const ids = prioritizeRecallEvidence(q, [pastKlm, pastKlm5, futureFlight, undated, move, ticket]).map((f: any) => f.id)
    assert.ok(!ids.includes('klm-13') && !ids.includes('klm-5'), q + ' → ' + ids.join(','))
    for (const keep of ['goa', 'pref', 'move', 'ticket']) assert.ok(ids.includes(keep), q + ' kept ' + keep)
  }
})
check('retrospective and unrelated questions keep past travel memories', () => {
  for (const q of ['When did Divya\'s flight land?', 'What was my last trip?', 'Show my goals']) {
    const ids = prioritizeRecallEvidence(q, [pastKlm, futureFlight]).map((f: any) => f.id)
    assert.ok(ids.includes('klm-13'), q)
  }
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 } else console.log('Upcoming-trip context excludes past saved flight memories; recall unaffected.')
