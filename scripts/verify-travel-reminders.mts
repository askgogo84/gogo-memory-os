// Verifies the travel-ticket reminder SCHEDULING logic — the decisions that decide
// whether a departure alert, a check-in nudge, or a "check-in already open" note is
// produced for a leg given the moment it was saved.
//
// Regression under test: a boarding-pass PHOTO saved a perfect travel_tickets row but
// created ZERO reminders. Two bugs fed it — the reminders insert omitted chat_id/sent
// (rejected + swallowed), and a ticket saved AFTER the check-in window opened got no
// nudge at all. The insert-column fix is DB-shaped (not exercised here); this harness
// pins the pure decision path so future edits can't silently drop a leg's alerts again.
// Run: npx tsx scripts/verify-travel-reminders.mts
//
// Imports the REAL shipped buildLegs + planLegReminders (via tsx, which resolves @/) so
// test and prod can't drift. Dummy Supabase env is set BEFORE import because the module
// builds a client at load — planLegReminders itself issues no query.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { buildLegs, planLegReminders } = await import('../lib/services/travel-tickets')

let fails = 0

// The reported ticket: IndiGo 6E 5237, BLR→BOM, 25 Aug 2026 10:15 IST.
// computeDepartAt → 2026-08-25T04:45:00Z. IndiGo (6E) check-in opens 48h before.
const flightInfo = {
  type: 'flight' as const,
  flights: [
    {
      from: 'BLR', to: 'BOM', date: '25 Aug 2026',
      departure: '10:15', arrival: '11:45',
      airline: 'IndiGo', flightNo: '6E 5237', pnr: 'U913GC', seat: '11D',
    },
  ],
  passengers: ['Test User'],
}

const leg = buildLegs(flightInfo)[0]

// Sanity: the leg parsed to the expected UTC instant, else every case below is moot.
if (leg?.departAt?.toISOString() !== '2026-08-25T04:45:00.000Z') {
  console.log(`  ✗  leg.departAt parsed to ${leg?.departAt?.toISOString()} (want 2026-08-25T04:45:00.000Z)`)
  fails++
}

// A decision summarised as "kind@remindAtIso" (open-now has no remindAt).
function summarise(now: string): string[] {
  return planLegReminders(leg, new Date(now).getTime()).map((d) =>
    d.kind === 'checkin_open_now' ? d.kind : `${d.kind}@${d.remindAt.toISOString()}`,
  )
}

function expectPlan(label: string, now: string, want: string[]) {
  const got = summarise(now)
  const ok = got.length === want.length && got.every((g, i) => g === want[i])
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  ${label}`)
  console.log(`       saved ${now}`)
  console.log(`       got  [${got.join(', ')}]`)
  if (!ok) console.log(`       want [${want.join(', ')}]`)
}

console.log('\nplanLegReminders schedules the right alerts per save-time\n')

// 1) Saved well before departure AND before the 48h check-in window opens:
//    both the T-3h departure alert and the T-48h check-in nudge are scheduled.
expectPlan(
  'future departure, before check-in window → departure + check-in scheduled',
  '2026-08-20T00:00:00.000Z',
  ['departure@2026-08-25T01:45:00.000Z', 'checkin@2026-08-23T04:45:00.000Z'],
)

// 2) THE BUG SCENARIO — saved after the 48h window opened (24 Aug) but before
//    departure: the check-in nudge can't be scheduled in the past, so instead of
//    vanishing it becomes a "check-in already open" note; the departure alert (still
//    >3h out) is still scheduled.
expectPlan(
  'after check-in opened, before departure → departure + check-in_open_now',
  '2026-08-24T06:00:00.000Z',
  ['departure@2026-08-25T01:45:00.000Z', 'checkin_open_now'],
)

// 3) Saved inside the final 3h before departure: the departure alert is correctly
//    suppressed (can't fire in the past), but check-in is still open → note only.
expectPlan(
  'within 3h of departure → check-in_open_now only (no past departure alert)',
  '2026-08-25T03:00:00.000Z',
  ['checkin_open_now'],
)

// 4) Saved after departure: nothing to schedule, nothing to surface.
expectPlan(
  'after departure → no decisions',
  '2026-08-26T00:00:00.000Z',
  [],
)

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
