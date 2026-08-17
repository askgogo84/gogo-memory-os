// Verifies the reminder cancel matcher: extractCancelQuery strips recurrence
// adverbs + determiners so a real match survives, and reminderMatches never
// over-matches an empty/foreign query. Run: npx tsx scripts/verify-cancel-matcher.mts
//
// Imports the REAL shipped functions from edit-reminder.ts (via tsx, which resolves
// the @/ alias) so test and prod can't drift. Dummy Supabase env is set BEFORE the
// dynamic import because the module constructs a client at load — no query is issued.
//
// Regression under test: "Brush your hair" stored, user says "remove brush my hair
// reminder daily" — "daily" used to survive as a required token and kill the match.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { extractCancelQuery, reminderMatches } = await import('../lib/bot/handlers/edit-reminder')

// The stored reminder the user is trying to cancel.
const REMINDER = { message: 'Brush your hair', remind_at: '2026-08-17T10:40:00.000Z' }

// The caller (cancelReminder) lowercases + number-word-normalises before calling
// extractCancelQuery, then only calls reminderMatches when the query is non-null.
function cancelResolves(input: string): boolean {
  const query = extractCancelQuery(input.toLowerCase().trim())
  if (!query) return false
  return reminderMatches(REMINDER, query)
}

let fails = 0
function expect(input: string, want: boolean, note = '') {
  const got = cancelResolves(input)
  const ok = got === want
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  ${want ? 'MATCH   ' : 'NO-MATCH'}  "${input}"${note ? `  (${note})` : ''}`)
}

console.log('\nCancel matcher against stored reminder "Brush your hair"\n')

// Positive: real cancels for this reminder must resolve.
expect('remove brush my hair reminder daily', true, 'recurrence adverb "daily" stripped')
expect('cancel the brush my hair reminder', true, 'determiner "the" stripped')
expect('cancel brush hair', true, 'bare tokens')

// Negative: queries that reduce to nothing must NOT match anything (fall to list).
expect('cancel daily', false, 'empty after stripping "daily"')
expect('cancel the reminder', false, 'empty after stripping "the"+"reminder"')

// Negative: a genuine query for a different reminder must not hit this one.
expect('cancel drink water', false, 'foreign reminder')

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
