// Verifies the unified pending-clarification completion (FIX 2).
// Run: npx tsx scripts/verify-pending-followup.mts
//
// Imports the REAL shipped helpers (resolvePendingReminder/Calendar, looksLikeNewCommand,
// isFreshFollowupState) so test and prod can't drift. Dummy Supabase env is set BEFORE the
// dynamic import because followup-state builds a client at load — no query is issued.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { resolvePendingReminder, resolvePendingCalendar, looksLikeNewCommand } = await import(
  '../lib/bot/pending-followup'
)
const { isFreshFollowupState } = await import('../lib/bot/handlers/followup-state')

let fails = 0
function ok(label: string, cond: boolean) {
  if (!cond) fails++
  console.log(`  ${cond ? '✓' : '✗'}  ${label}`)
}

// Answers the clarifying prompt itself advertises. Each must resolve to a valid FUTURE
// instant. (We assert future, not a specific day: "8pm today" run after 8pm rolls to the
// next occurrence via the "at" fallback — that's correct, not a failure.)
const ANSWERS = ['8pm today', 'in 2 hours', 'every Monday 10 AM']
const future = (iso?: string) => !!iso && !isNaN(Date.parse(iso)) && Date.parse(iso) > Date.now() - 60_000

console.log('\nPending reminder completion\n')
for (const a of ANSWERS) {
  const r = resolvePendingReminder({ task: 'pay rent' }, a)
  ok(`reminder "${a}" → future instant`, future(r?.remindAtIso))
}
// Bare clock time resolves via the inserted-"at" fallback (parseSimpleAtTime needs "at").
ok('reminder "8 pm" (bare) → future instant', future(resolvePendingReminder({ task: 'pay rent' }, '8 pm')?.remindAtIso))
// A non-time answer does NOT resolve — caller falls through instead of inventing a time.
ok('reminder "the blue one" → null (no time)', resolvePendingReminder({ task: 'pay rent' }, 'the blue one') === null)

console.log('\nPending calendar completion\n')
for (const a of ANSWERS) {
  const c = resolvePendingCalendar({ title: 'demo sync' }, a)
  ok(`calendar "${a}" → future instant`, future(c?.remindAtIso))
}
// Stored day context ("tomorrow") is carried when the answer omits a day.
{
  const c = resolvePendingCalendar({ title: 'demo sync', target: 'tomorrow' }, '3pm')
  const d = c?.remindAtIso ? new Date(c.remindAtIso) : null
  ok('calendar target=tomorrow + "3pm" → future instant', future(c?.remindAtIso) && !!d)
}

console.log('\nNew-command guard (must NOT swallow fresh commands)\n')
ok('"show my calendar" is a new command', looksLikeNewCommand('show my calendar') === true)
ok('"add milk to groceries" is a new command', looksLikeNewCommand('add milk to groceries') === true)
ok('"remind me to call mom at 5pm" is a new command', looksLikeNewCommand('remind me to call mom at 5pm') === true)
// Time answers must NOT be treated as new commands.
ok('"8pm today" is a time answer', looksLikeNewCommand('8pm today') === false)
ok('"in 2 hours" is a time answer', looksLikeNewCommand('in 2 hours') === false)
ok('"every Monday 10 AM" is a time answer', looksLikeNewCommand('every Monday 10 AM') === false)
ok('"8 pm" is a time answer', looksLikeNewCommand('8 pm') === false)

console.log('\nTTL (stale pending is ignored)\n')
const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString()
const now = new Date().toISOString()
ok('11-min-old record is stale', isFreshFollowupState({ created_at: elevenMinAgo }) === false)
ok('fresh record is honored', isFreshFollowupState({ created_at: now }) === true)
ok('payload.created_at is read too', isFreshFollowupState({ payload: { created_at: elevenMinAgo } }) === false)

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
