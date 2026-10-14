// 14 Oct phone run: (1) "Which reminders are set for friday?" listed every reminder because only
// today/tomorrow/dates were understood; (2) "Create a Google Doc with my meeting notes in my Drive" asked
// "What time should I add it?" because "meeting" was read as a calendar event; (3) "Show my latest email
// from Google" returned Zerodha and GitHub mail because the sender was dropped from the search.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'

const { resolveReminderDay } = await import('../lib/agent/compound-planner')
const { extractEmailSender, workspaceSearchTerms } = await import('../lib/agent/google-workspace-read')
const { isDriveWriteRequest } = await import('../lib/bot/drive-write-request')
const { parseCalendarCreate } = await import('../lib/bot/handlers/calendar-actions')

// Wednesday 14 Oct 2026, 09:30 IST.
const wed = new Date('2026-10-14T04:00:00Z')
const day = (text: string) => resolveReminderDay(text.toLowerCase(), 'Asia/Kolkata', wed)
assert.equal(day('Which reminders are set for friday?')?.date, '2026-10-16')
assert.equal(day('Which reminders are set for friday?')?.label, 'Fri, 16 Oct')
assert.equal(day('what do I have on wednesday')?.date, '2026-10-14', 'the same weekday means today')
assert.equal(day('reminders for next wednesday')?.date, '2026-10-21', '"next" skips today')
assert.equal(day('reminders this monday')?.date, '2026-10-19')
assert.equal(day('reminders tomorrow')?.date, '2026-10-15')
assert.equal(day('reminders tomorrow')?.label, 'tomorrow')
assert.equal(day('reminders today')?.label, 'today')
assert.equal(day('reminders the day after tomorrow')?.date, '2026-10-16')
assert.equal(day('show my reminders'), null, 'no day named means all active reminders')
// Late evening UTC is already the next day in India.
assert.equal(resolveReminderDay('reminders today', 'Asia/Kolkata', new Date('2026-10-14T20:00:00Z'))?.date, '2026-10-15')

// A sender is a from: constraint of the search, not a keyword.
assert.deepEqual(extractEmailSender('Show my latest email from Google').sender, 'Google')
assert.equal(extractEmailSender('Show my latest email from Google').rest.toLowerCase().includes('google'), false)
assert.equal(extractEmailSender('find the latest mail from Zerodha about statements').sender, 'Zerodha')
assert.equal(extractEmailSender('any email from Swiggy Instamart?').sender, 'Swiggy Instamart')
assert.equal(extractEmailSender('Show my latest email').sender, null)
assert.equal(extractEmailSender('summarise the thread from yesterday').sender, null, 'no email noun, no sender')
assert.ok(!workspaceSearchTerms(extractEmailSender('Show my latest email from Google').rest).includes('google'))

// A request to make a new document is a Drive write, however the words fall.
for (const t of [
  'Create a Google Doc with my meeting notes in my Drive',
  'make me a new google doc of the call summary',
  'Generate a Google Sheet for my expenses and put it in my Drive',
  'draft a document in my drive about the launch plan',
]) assert.equal(isDriveWriteRequest(t), true, t)
for (const t of [
  'Find the launch plan doc in my Drive',
  'Show my latest email from Google',
  'Add a meeting with Srini tomorrow at 4 pm',
  'Make a list of things to buy',
]) assert.equal(isDriveWriteRequest(t), false, t)

// "meeting notes" is a document, not an event; real meetings still create events.
assert.equal(parseCalendarCreate('Create a Google Doc with my meeting notes in my Drive'), null)
assert.equal(parseCalendarCreate('add the meeting notes to my Drive doc'), null)
assert.ok(parseCalendarCreate('Add a meeting with Srini tomorrow at 4 pm'))
assert.ok(parseCalendarCreate('Schedule a call with Rahul tomorrow at 5 pm'))

console.log('✅ checklist batch 3: weekday reminder questions, document creation vs calendar, email sender search')
