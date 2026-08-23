// Verifies interval reminders advance AND read back correctly in BOTH stored shapes:
//   compact  — every_2h / every_1d          (LLM path)
//   verbose  — every_2_hours / every_15_minutes / every_3_days   (the create parser)
// Regression under test: getNextOccurrence used to match only every_Nh/every_Nd, so a
// verbose interval (the ONLY shape the create parser writes) fell through to the default
// +1 day and silently recurred daily. getNextOccurrence + describeCadence now share one
// parser (parseIntervalPattern), so advance math and copy can't disagree.
//
// Also guards that the dashboard 'label' chips still read EXACTLY as shipped.
// Run: npx tsx scripts/verify-interval-cadence.mts
//
// Imports the REAL shipped functions (via tsx, which resolves @/) so test and prod can't
// drift. Dummy Supabase env is set BEFORE import because the module builds a client at
// load — no query is issued.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { getNextOccurrence, describeCadence } = await import('../lib/services/reminder-series')

let fails = 0

// ── getNextOccurrence: one case per form ──────────────────────────────────────
const BASE = new Date('2026-08-23T12:00:00.000Z')
const deltaMin = (out: Date) => Math.round((out.getTime() - BASE.getTime()) / 60000)

// Exact for minute/hour forms; day forms allow ±60 min so a DST boundary can't flake it.
function expectAdvance(pattern: string, wantMin: number, tolMin = 0, note = '') {
  const got = deltaMin(getNextOccurrence(pattern, BASE))
  const ok = Math.abs(got - wantMin) <= tolMin
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  advance  "${pattern}"  → +${got}min (want +${wantMin}${tolMin ? `±${tolMin}` : ''})${note ? `  (${note})` : ''}`)
}

console.log('\ngetNextOccurrence advances each interval form correctly\n')
// verbose (create parser) — these were the broken ones (advanced daily = 1440).
expectAdvance('every_5_minutes', 5, 0, 'was silently daily')
expectAdvance('every_15_minutes', 15, 0, 'was silently daily')
expectAdvance('every_2_hours', 120, 0, 'was silently daily')
expectAdvance('every_3_days', 3 * 1440, 60)
expectAdvance('every_1_day', 1440, 60)
// compact (LLM path) — must keep working.
expectAdvance('every_2h', 120, 0)
expectAdvance('every_6h', 360, 0)
expectAdvance('every_1d', 1440, 60)
// non-interval sanity: plain daily still advances one day, not parsed as an interval.
expectAdvance('daily', 1440, 60, 'not an interval')

// ── describeCadence: sentence + label per form ────────────────────────────────
function expectText(pattern: string, style: 'sentence' | 'label', want: string) {
  const got = describeCadence(pattern, style)
  const ok = got === want
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  ${style.padEnd(8)} "${pattern}"  → "${got}"${ok ? '' : `  (want "${want}")`}`)
}

console.log('\ndescribeCadence humanizes each interval form (both renderings)\n')
expectText('every_2_hours', 'sentence', 'every 2 hours')
expectText('every_2_hours', 'label', 'Every 2 hours')
expectText('every_15_minutes', 'sentence', 'every 15 minutes')
expectText('every_15_minutes', 'label', 'Every 15 minutes')
expectText('every_2h', 'sentence', 'every 2 hours')
expectText('every_1d', 'sentence', 'every 1 day')
expectText('every_1d', 'label', 'Every day')
expectText('every_3_days', 'label', 'Every 3 days')

console.log('\ndashboard label chips read EXACTLY as shipped (change A — no regression)\n')
expectText('daily', 'label', 'Every day')
expectText('every day', 'label', 'Every day')
expectText('every Monday', 'label', 'Every Monday')
expectText('weekly:tuesday:13:00', 'label', 'Every week')
expectText('hourly_between:09:00-21:00:daily', 'label', 'Hourly')
expectText('followup:2h:ping', 'label', 'Follow-up')
// sentence form used by the create/stop/skip copy.
expectText('daily', 'sentence', 'daily')

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
