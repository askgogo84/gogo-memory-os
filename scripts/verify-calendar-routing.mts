// Verifies the calendar-create vs reminder routing precedence.
// Run: npx tsx scripts/verify-calendar-routing.mts
//
// Imports the REAL shipped gate functions (parseCalendarCreate, isCalendarViewRequest)
// so test and prod can't drift. Dummy Supabase env is set BEFORE the dynamic import
// because the module builds a client at load — no query is issued.
//
// Models the REAL dispatch in process-message.ts: isCalendarAction gates entry, but
// buildCalendarActionReply only CLAIMS (handled:true) when the text is a calendar view
// OR parses as a calendar-create; otherwise it returns handled:false and the message
// falls through to the reminder catch-all (line 703 runs BEFORE the reminder create at
// line 774). So a passing "calendar" mention with no create trigger routes to reminder.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { parseCalendarCreate, isCalendarViewRequest } = await import('../lib/bot/handlers/calendar-actions')

function route(text: string): string {
  if (isCalendarViewRequest(text)) return 'calendar_view'
  if (parseCalendarCreate(text)) return 'calendar_create'
  // reminder catch-all — mirrors detectIntent's set_reminder signals (detect-intent.ts:145):
  // remind verb, tomorrow/weekday/relative, or an explicit clock time.
  if (
    /\bremind\b/i.test(text) ||
    /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text) ||
    /\b(tomorrow|tmrw|tmr)\b/i.test(text) ||
    /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text) ||
    /\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i.test(text)
  ) return 'reminder'
  return 'general'
}

let fails = 0
function eq(label: string, got: string, want: string) {
  const ok = got === want
  if (!ok) fails++
  console.log(`  ${ok ? '✓' : '✗'}  ${label}  got=${got} want=${want}`)
}

console.log('\nCalendar-create vs reminder routing\n')

// B.1 — the reported miss: "add to MY calendar" now claims calendar-create, not reminder.
eq('"Meeting with Srini add to my calendar at 11:30 am"', route('Meeting with Srini add to my calendar at 11:30 am'), 'calendar_create')
eq('"add it to my calendar at 6 pm"', route('add it to my calendar at 6 pm'), 'calendar_create')
// Existing create phrasings still work.
eq('"add meeting with Rahul tomorrow at 4 pm"', route('add meeting with Rahul tomorrow at 4 pm'), 'calendar_create')

// B.2 — anti-swallow: a genuine reminder that MENTIONS calendar in passing stays a
// reminder (no create VERB, so parseCalendarCreate declines).
eq('"remind me to check my calendar at 5 pm"', route('remind me to check my calendar at 5 pm'), 'reminder')
eq('"add milk to my grocery list at 8 am"', route('add milk to my grocery list at 8 am'), 'reminder')

// B.3 — structural isCreate (FIX 1): articles + synonyms + verbs no longer break detection.
// Each of these MUST route to calendar_create (the article "a"/"an"/"the" used to break it).
eq('"add a meeting with demo at 8pm to my calendar"', route('add a meeting with demo at 8pm to my calendar'), 'calendar_create')
eq('"schedule a call with Priya tomorrow at 3pm"', route('schedule a call with Priya tomorrow at 3pm'), 'calendar_create')
eq('"book an appointment at 5pm"', route('book an appointment at 5pm'), 'calendar_create')
eq('"put dinner on my calendar at 8"', route('put dinner on my calendar at 8'), 'calendar_create')
eq('"add dinner with mom to my calendar"', route('add dinner with mom to my calendar'), 'calendar_create')
eq('"create an event for Friday 10am"', route('create an event for Friday 10am'), 'calendar_create')

// B.3b — misspelled "calendar" still routes to calendar_create (demo-recording regression:
// "add a meeting with Demo at 7pm to my calender" was filed into a LIST named "calender").
eq('"add a meeting with demo at 7pm to my calender"', route('add a meeting with demo at 7pm to my calender'), 'calendar_create')
eq('"add a meeting with demo at 7pm to my calandar"', route('add a meeting with demo at 7pm to my calandar'), 'calendar_create')

// B.4 — anti-swallow (FIX 1): "schedule lunch tomorrow" is a create VERB with NO calendar
// noun/phrase, genuinely ambiguous with a reminder → stays a reminder (documented behaviour).
eq('"schedule lunch tomorrow"', route('schedule lunch tomorrow'), 'reminder')

// View requests are unaffected.
eq('"what is on my calendar"', route('what is on my calendar'), 'calendar_view')

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
