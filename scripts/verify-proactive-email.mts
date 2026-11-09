// 1 Nov live (screenshot 23:40): the evening pulse pushed AskGogo's own tips mail, a ResellerClub price notice and an
// IndiaFilings AOC-4 deadline that had already passed, twice, next to the one email that mattered (Vercel card failed).
// Gogo must push only email that clearly needs the person: at most 2 a day, each once, and learn from "not important".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { selectProactiveEmails, formatProactiveEmailCard, emailFromLoop, mentionsPassedDeadline, PROACTIVE_EMAILS_PER_DAY } = await import('../lib/email/proactive')
const { ATTENTION_CARD_HEADING } = await import('../lib/email/attention')

const NOW = Date.parse('2026-11-01T18:00:00Z') // 11:30 pm IST
const hoursAgo = (h: number) => NOW - h * 3600_000
let n = 0
const loop = (o: { title: string; summary: string; from: string; hours?: number; kind?: string; type?: string; unread?: boolean; thread?: string }) => {
  n++
  const type = o.type || 'gmail_thread'
  return {
    id: `loop-${n}`, kind: o.kind || 'commitment', title: o.title, summary: o.summary, source_type: type,
    source_id: o.thread || `1a1${n}f8e05ba8`,
    evidence_json: type === 'gmail_service_notice' ? { sender: o.from, last_message_id: `m${n}` } : { last_message_from: o.from, last_internal_date: hoursAgo(o.hours ?? 3), last_message_id: `m${n}`, unread: o.unread ?? true },
    created_at: new Date(hoursAgo(o.hours ?? 3)).toISOString(),
  }
}

const vercel = loop({ type: 'gmail_service_notice', title: 'Review service billing notice — [Action Required] Payment Failed And Shutdown Coming Soon', summary: 'Payment failed and shutdown coming soon. We failed to charge your card ending with 1712 for the team goverdhanmd-9559\'s projects.', from: 'billing@vercel.com', thread: '1a158a13f8e05ba8' })
const askgogoTips = loop({ title: 'Reply to Gogo from AskGogo — Gogo, deadlines are cheaper before they are urgent', summary: 'Renewals, taxes, payments and expiries belong on the calendar before the panic. Give important dates a home early. Please add your renewal dates.', from: 'Gogo from AskGogo <gogo@mail.askgogo.in>' })
const indiaFilings = loop({ title: 'Reply to IndiaFilings Team — Important: Annual Accounts (Form AOC-4) Filing Deadline — Compliance Notice', summary: 'Hi Goverdhan MD, The deadline for filing your company\'s annual accounts (Form AOC-4) is 29th October 2026. Not sure where to begin? Please reply to get started.', from: 'IndiaFilings Team <compliance@indiafilings.com>' })
const resellerClub = loop({ title: 'Reply to ResellerClub India — Action Required: .COM Price Revision Effective 1st November 2026', summary: 'Tap to read more', from: 'ResellerClub India <care@resellerclub.com>' })
const divya = loop({ title: 'Reply to Divya — Approve the venue for Saturday?', summary: 'Can you approve the venue by today? I need to confirm the booking.', from: 'Divya <divya@example.com>' })
const nithin = loop({ title: 'Reply to Nithin K L — Decide on the POS integration date', summary: 'Please decide which date works for the POS go-live by tomorrow.', from: 'Nithin K L <nithin@tipplr.in>' })

const screenshot = [vercel, askgogoTips, indiaFilings, resellerClub]
const keys = (list: any[]) => list.map(p => p.loopId)

// The screenshot's evening: only the Vercel cut-off notice gets through.
{
  const picked = selectProactiveEmails(screenshot, { now: NOW })
  assert.deepEqual(keys(picked), [vercel.id], JSON.stringify(picked.map(p => [p.senderName, p.score, p.category])))
  console.log('✓ screenshot: only the Vercel shutdown notice is pushed (AskGogo tips, IndiaFilings, ResellerClub skipped)')
}
// Own product mail never needs the person, however it is phrased.
assert.equal(selectProactiveEmails([askgogoTips], { now: NOW }).length, 0)
console.log('✓ AskGogo\'s own mail is never pushed')
// A deadline that already passed, sent by a company team, is not urgent news.
assert.equal(selectProactiveEmails([indiaFilings], { now: NOW }).length, 0)
console.log('✓ a company "team" notice about a deadline that already passed is not pushed')
// A person asking for a decision today does get through.
assert.deepEqual(keys(selectProactiveEmails([divya], { now: NOW })), [divya.id])
console.log('✓ a person asking you to approve something today is pushed')

// At most 2 a day: three good emails → the best two; one already sent today → one more; two sent → none.
{
  assert.equal(PROACTIVE_EMAILS_PER_DAY, 2)
  const three = [vercel, divya, nithin]
  assert.equal(selectProactiveEmails(three, { now: NOW }).length, 2)
  assert.equal(selectProactiveEmails(three, { now: NOW, sentToday: 1 }).length, 1)
  assert.equal(selectProactiveEmails(three, { now: NOW, sentToday: 2 }).length, 0)
  assert.equal(selectProactiveEmails(three, { now: NOW })[0].loopId, vercel.id, 'the service cut-off ranks first')
  console.log('✓ at most 2 emails a day, best first')
}
// Each email once: an email pushed before (as an email card or an older pulse line) is never pushed again.
assert.equal(selectProactiveEmails([vercel], { now: NOW, alreadySurfaced: new Set([`email:${vercel.source_id}`]) }).length, 0)
assert.equal(selectProactiveEmails([divya], { now: NOW, alreadySurfaced: new Set([`open_loop:${divya.id}`]) }).length, 0)
console.log('✓ an email already pushed is never pushed again')
// Old mail is not news.
assert.equal(selectProactiveEmails([loop({ title: 'Reply to Divya — Approve the venue?', summary: 'Can you approve the venue by today?', from: 'Divya <divya@example.com>', hours: 60 })], { now: NOW }).length, 0)
console.log('✓ email older than 48 hours is not pushed')
// "Waiting for a reply" on the person's own sent mail is not an incoming email to push.
assert.equal(selectProactiveEmails([loop({ kind: 'waiting_on', title: 'Waiting for reply from Divya — Venue', summary: 'Can you confirm?', from: 'me@example.com' })], { now: NOW }).length, 0)
console.log('✓ waiting-for-reply threads are not pushed')

// Learning: "not important" (a never rule) silences that sender; "important" (always) lets a routine ask through.
{
  const never = [{ kind: 'never' as const, matchType: 'sender' as const, matchValue: 'divya@example.com', label: 'mail from Divya', source: 'feedback' as const }]
  assert.equal(selectProactiveEmails([divya], { now: NOW, rules: never }).length, 0)
  const question = loop({ title: 'Reply to Divya — Lunch on Sunday?', summary: 'Are you free for lunch on Sunday?', from: 'Divya <divya@example.com>' })
  assert.equal(selectProactiveEmails([question], { now: NOW }).length, 0, 'a casual question is not urgent by default')
  const always = [{ kind: 'always' as const, matchType: 'sender' as const, matchValue: 'divya@example.com', label: 'mail from Divya', source: 'feedback' as const }]
  assert.equal(selectProactiveEmails([question], { now: NOW, rules: always }).length, 1)
  console.log('✓ learns from "not important" and "important" marks')
}

// The card: same heading as "emails that need me" (so "open 1" / "not important 1" bind), no long Gmail links.
{
  const card = formatProactiveEmailCard(selectProactiveEmails([vercel, divya], { now: NOW }), { timezone: 'Asia/Kolkata', now: NOW })
  assert.match(card, ATTENTION_CARD_HEADING)
  assert.match(card, /^📬 2 emails need you/)
  assert.match(card, /not important 2/)
  assert.match(card, /open 1/)
  assert.doesNotMatch(card, /mail\.google\.com|https?:\/\//, 'no raw links: they render as a big preview card on WhatsApp')
  assert.ok(card.split('\n').length <= 14, card)
  console.log('✓ card reads like the email card, with no raw Gmail links')
}
assert.equal(mentionsPassedDeadline('The deadline for filing is 29th October 2026.', NOW), true)
assert.equal(mentionsPassedDeadline('The deadline for filing is 29th November 2026.', NOW), false)
assert.equal(mentionsPassedDeadline('Payment due on November 3, 2026', NOW), false)
assert.equal(mentionsPassedDeadline('Met on 29th October 2026 for coffee', NOW), false, 'a past date without a deadline is not a deadline')
console.log('✓ passed-deadline detection')
assert.equal(emailFromLoop({ id: 'x', title: 'Reply to A — B', summary: '', evidence_json: {} } as any), null, 'no sender, no email')

// Pulse wiring: email loops never appear as pulse lines; the email card runs first; events once a day.
{
  const src = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8')
  assert.match(src, /if\(isEmailLoop\(loop\)\)continue/)
  assert.ok(src.indexOf('sendProactiveEmailCard(telegramId') < src.indexOf('const pulse=await buildPulse('), 'email card is decided before the general pulse')
  assert.match(src, /eventKeysToday\.has\(`event:\$\{e\.id\}:\$\{e\.start_at\}`\)/)
  assert.match(src, /in\('event_type',\['autonomy_pulse_sent','autonomy_email_sent'\]\)/)
  assert.doesNotMatch(src, /eq\('telegram_id',Number\(telegramId\)\)/)
  console.log('✓ pulse: emails only via the selective card, events once a day, exact owner lookups')
}
console.log('Proactive email checks passed')
