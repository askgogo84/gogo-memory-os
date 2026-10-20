// 20 Oct 2026 ~23:00 IST, dashboard chat live failures (R4):
// 1. "Movies showing near Rajajinagar this Sunday evening" was swallowed by an open flight question ("evening" read
//    as a departure time) and answered "Please send the travel date…".
// 2. "Find flights from Bangalore to Delhi next Friday" asked for the travel date: weekdays were not dates.
// 3. "Any important emails today?" (Gmail connected) went to web search.
// 4. "Draft an email to Nithin saying I will be 15 minutes late to the 4pm meeting" ran the meeting-slot finder.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'

const t = await import('../lib/agent/travel-research.ts')
const tz = 'Asia/Kolkata'

// ── 1. A new request on another topic is not an answer to the open flight question ──
const movies = 'Movies showing near Rajajinagar this Sunday evening'
assert.equal(t.isFlightBriefAnswer(movies), false, 'movies must not answer a flight question')
assert.equal(t.isTravelResearchDetailsReply(movies), false, 'movies must not resume the flight brief')
assert.equal(t.isPublicTravelResearchRequest(movies), false)
for (const s of ['Any concerts this Saturday evening?', 'Restaurants near Indiranagar for tomorrow night', 'Weather tomorrow morning', 'Remind me to call mom tomorrow evening'])
  assert.equal(t.isTravelResearchDetailsReply(s), false, s)
// The travel entry point declines it before any database read (no pending-brief lookup for a new topic).
const { enqueueTravelResearch } = await import('../lib/agent/travel-research-queue.ts')
const actor: any = { userId: 'u1', legacyTelegramId: 4242, whatsappId: '9100', name: 'Divya', timezone: tz }
assert.equal(await enqueueTravelResearch({ actor, surface: 'web', text: movies }), null)
// Real answers to a flight question still bind.
for (const s of ['next Friday', 'tomorrow', 'on 24 Oct', 'evening', '2 adults', 'Check for round trip', 'business', 'one way'])
  assert.equal(t.isTravelResearchDetailsReply(s), true, s)

// ── 2. Weekdays and relative days resolve to a date in Asia/Kolkata ──
const tuesdayNight = new Date('2026-10-20T17:30:00Z') // Tue 20 Oct, 23:00 IST
const cases: Array<[string, string]> = [
  ['Find flights from Bangalore to Delhi next Friday', '2026-10-23'],
  ['Find flights from Bangalore to Delhi this Friday', '2026-10-23'],
  ['Find flights from Bangalore to Delhi on Friday', '2026-10-23'],
  ['Find flights from Bangalore to Delhi tomorrow', '2026-10-21'],
  ['Find flights from Bangalore to Delhi on 24 Oct', '2026-10-24'],
  ['flights BLR to DEL day after tomorrow', '2026-10-22'],
  ['Flights Bangalore to Delhi Friday 30 Oct', '2026-10-30'],
]
for (const [s, iso] of cases) {
  const brief = t.parseFlightBriefText(s, tuesdayNight, tz)
  assert.deepEqual([brief.originCode, brief.destinationCode, brief.departDate], ['BLR', 'DEL', iso], s)
  assert.deepEqual(t.flightBriefSlots(brief), [], `${s}: nothing left to ask, the search runs`)
}
// Just past midnight IST (still 20 Oct in UTC) it is already Wednesday 21 Oct in India.
const afterMidnight = new Date('2026-10-20T19:00:00Z')
assert.equal(t.parseFlightBriefText('Find flights from Bangalore to Delhi tomorrow', afterMidnight, tz).departDate, '2026-10-22')
assert.equal(t.parseFlightBriefText('Find flights from Bangalore to Delhi next Friday', afterMidnight, tz).departDate, '2026-10-23')
// On a Friday, "next Friday" is a week later (same rule as the calendar's weekdayDateParts).
assert.equal(t.parseFlightBriefText('flights from Bangalore to Delhi next Friday', new Date('2026-10-23T04:00:00Z'), tz).departDate, '2026-10-30')
// "next Friday" sent as the answer to "Please send the travel date" fills the open date.
const routeOnly = t.parseFlightBriefText('Find flights from Bangalore to Delhi', tuesdayNight, tz)
assert.deepEqual(t.flightBriefSlots(routeOnly), ['date'])
const answered = t.applyFlightBriefReply(routeOnly, ['date'], 'next Friday', tuesdayNight, tz)
assert.equal(answered.understood, true)
assert.equal(answered.brief.departDate, '2026-10-23')
assert.deepEqual(t.flightBriefSlots(answered.brief), [])
assert.equal(t.weekdayTravelDate('every Friday', new Date('2026-10-20T00:00:00Z')), null, 'a recurrence is not one date')

// ── 3. Personal-data questions never go to web search ──
const { detectIntent, isGmailReadRequest } = await import('../lib/bot/detect-intent.ts')
const pq = await import('../lib/agent/plain-question.ts')
for (const s of ['Any important emails today?', 'any new emails?', 'Do I have unread mails?', 'what emails came in today?', 'Any emails from Swiggy today?']) {
  assert.equal(isGmailReadRequest(s.toLowerCase()), true, s)
  assert.equal(detectIntent(s).type, 'read_gmail', s)
  assert.equal(pq.isPlainInfoQuestion(s), false, `${s}: not a plain web question`)
  assert.equal(pq.isPersonalDataQuestion(s), true, s)
  assert.equal(pq.isPersonalDataReadQuestion(s), true, `${s}: the dashboard skips the general planner`)
}
for (const s of ['Emails today?', "What's on my calendar tomorrow?", 'Any bookings in my reservations this week?', 'How much are my expenses this month?'])
  assert.equal(pq.isPersonalDataQuestion(s), true, s)
for (const s of ['How do I write a good cover email?', 'Best coworking space in Indiranagar', 'Who directed Jailer 2?'])
  assert.equal(pq.isPersonalDataQuestion(s), false, s)
assert.equal(pq.isPersonalDataReadQuestion('Draft an email to Nithin saying hi'), false, 'an action is not a read question')
assert.equal(pq.isPlainInfoQuestion('Who directed Jailer 2?'), true, 'plain questions keep the fast web path')
// process-message turns a web-search reading of a personal-data question back into the read path.
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.match(pm, /plainOrBase\.type === 'web_search' && isPersonalDataQuestion\(incomingText\)/)
assert.match(pm, /type: 'read_gmail', confidence: 'medium', meta: \{ personalData: true \}/)
const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
assert.match(route, /isPlainInfoQuestion\(text\) \|\| isPersonalDataReadQuestion\(text\)(?: \|\| isReminderReadOnlyAsk\(text\))? \? null : await tryRunGeneralPlan/)

// ── 4. A dictated email is a Gmail draft, never the meeting-slot finder ──
const gm = await import('../lib/agent/gmail-send.ts')
const wm = await import('../lib/agent/workspace-meeting-plan.ts')
const ask = 'Draft an email to Nithin saying I will be 15 minutes late to the 4pm meeting'
assert.equal(wm.isWorkspaceMeetingPrep(ask), false)
assert.equal(wm.isStandaloneWorkspaceMeetingPrep(ask), false)
assert.equal(wm.isWorkspaceMeetingPrep('Draft an email to Nithin proposing a slot for the meeting from my calendar availability'), true, 'meeting prep with availability still goes to meeting prep')
assert.equal(gm.isGmailReplyCommand(ask), true)
assert.deepEqual(gm.parseGmailComposeCommand(ask), { target: 'Nithin', said: 'I will be 15 minutes late to the 4pm meeting', draftOnly: true })
assert.equal(gm.parseGmailComposeCommand('Draft a reply to the latest email from Ravi saying Thanks'), null, 'replies keep the reply parser')
assert.equal(gm.parseGmailComposeCommand('Write an email'), null)
const written = gm.composeDraftFromDictation('Nithin', 'I will be 15 minutes late to the 4pm meeting')
assert.equal(written.subject, 'I will be 15 minutes late to the 4pm meeting')
assert.equal(written.body, 'Hi Nithin,\n\nI will be 15 minutes late to the 4pm meeting.')
assert.doesNotMatch(written.body, /regards|thanks,\s*$/i, 'no sign-off; Gmail adds the signature')
// The recipient is the one address Nithin uses in recent mail; ambiguity or none asks instead of guessing.
const threads = [
  { messages: [{ from: 'Nithin K L <nithin.kl@tipplr.in>', to: 'Goverdhan <me@example.com>' }, { from: 'Goverdhan <me@example.com>', to: 'Nithin K L <nithin.kl@tipplr.in>, Divya <divya@example.com>' }] },
  { messages: [{ from: 'Swiggy <noreply@swiggy.in>', to: 'me@example.com', subject: 'Nithin, your order' }] },
]
assert.deepEqual(gm.recipientFromThreads(threads, 'Nithin', 'me@example.com'), { status: 'resolved', email: 'nithin.kl@tipplr.in' })
assert.deepEqual(gm.recipientFromThreads(threads, 'nithin@other.com', 'me@example.com'), { status: 'resolved', email: 'nithin@other.com' })
assert.equal(gm.recipientFromThreads(threads, 'Rishi', 'me@example.com').status, 'not_found')
// 21 Oct live: a received newsletter "Nithin" never beats the colleague the user has written to.
assert.deepEqual(gm.recipientFromThreads([...threads, { messages: [{ from: 'Nithin Kamath <nithin@zerodha.com>', to: 'me@example.com' }] }], 'Nithin', 'me@example.com'), { status: 'resolved', email: 'nithin.kl@tipplr.in' })
// Two Nithins, neither ever written to: ask instead of guessing.
assert.equal(gm.recipientFromThreads([{ messages: [{ from: 'Nithin R <nithin.r@example.org>', to: 'me@example.com' }] }, { messages: [{ from: 'Nithin Kamath <nithin@zerodha.com>', to: 'me@example.com' }] }], 'Nithin', 'me@example.com').status, 'ambiguous')
// Only a received-only match (21 Oct live: a newsletter): suggest it, never fill it in silently.
assert.deepEqual(gm.recipientFromThreads([{ messages: [{ from: 'Nithin Kamath <nithin@zerodha.com>', to: 'me@example.com' }] }], 'Nithin', 'me@example.com'), { status: 'unconfirmed', email: 'nithin@zerodha.com' })
// Automated senders never count.
assert.equal(gm.recipientFromThreads([{ messages: [{ from: 'Nithin Updates <updates@news.example>', to: 'me@example.com' }] }], 'Nithin', 'me@example.com').status, 'not_found')
// Draft only: the compose branch stores a draft and returns before any approval or send.
const gmail = readFileSync(new URL('../lib/agent/gmail-send.ts', import.meta.url), 'utf8')
const composeStart = gmail.indexOf('const compose=parseGmailComposeCommand(raw)')
const composeEnd = gmail.indexOf('const parsed=parseGmailReplyCommand(raw)', composeStart)
const composeBranch = gmail.slice(composeStart, composeEnd)
assert.ok(composeStart > 0 && composeEnd > composeStart)
assert.doesNotMatch(composeBranch, /stageApproval|sendGmailReply/, 'composing never stages or sends')
assert.match(composeBranch, /Nothing has been sent\. Check the address above, then say \*send it\*/)
// "send it" on a new email goes through the same bound approval: stage and execute share one target function.
assert.equal((gmail.match(/target:approvalTarget\(draft\)/g) || []).length, 2)
assert.match(gmail, /gmail_new:\$\{String\(draft\.to\|\|''\)\.toLowerCase\(\)\}/)
// A new email starts a new thread: no threadId and no "Re:" on the wire.
const { sendGmailReply } = await import('../lib/services/google-gmail.ts')
const sent: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (_url: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'm1', threadId: 't-new' }), { status: 200 }) }) as any
try {
  const receipt = await sendGmailReply('token', { newMessage: true, threadId: '', to: 'nithin.kl@tipplr.in', subject: written.subject, body: written.body })
  assert.equal(receipt.threadId, 't-new')
  assert.equal('threadId' in sent[0], false)
  assert.match(Buffer.from(sent[0].raw, 'base64url').toString('utf8'), /^To: nithin\.kl@tipplr\.in\r\nSubject: I will be 15 minutes late/)
  await sendGmailReply('token', { threadId: 't1', to: 'ravi@example.com', subject: 'Plan', body: 'ok' })
  assert.equal(sent[1].threadId, 't1', 'replies keep their thread')
  assert.match(Buffer.from(sent[1].raw, 'base64url').toString('utf8'), /Subject: Re: Plan/)
} finally { globalThis.fetch = realFetch }
// The dashboard sends a dictated email to the Gmail draft before the meeting-prep matcher.
const composeAt = route.indexOf("await import('@/lib/agent/gmail-send')")
assert.ok(composeAt > 0 && composeAt < route.indexOf('if (isStandaloneWorkspaceMeetingPrep(text))'))

console.log('R4 routing (movies vs flight question, weekday flight dates, personal data never web, dictated email draft) passed')
