// 29 Oct live: tracking asks became bare reminders. A "check X" reminder and a named flight's departure
// reminder now carry the live answer at delivery.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const m = await import('../lib/agent/lookup-reminder')
assert.equal(m.isLookupReminder('⏰ Check Israel election results'), true)
assert.equal(m.isLookupReminder('Check Israel election results'), true)
assert.equal(m.isLookupReminder('See the India vs NZ match score'), true)
assert.equal(m.isLookupReminder('Stretch'), false)
assert.equal(m.isLookupReminder('Call Nithin'), false)
assert.equal(m.isLookupReminder('Pay rent'), false)
assert.equal(m.isLookupReminder('Carry an umbrella if it rains'), false)
assert.equal(m.departureFlightCode('✈️ IndiGo 6E 5256 · Bengaluru → Mumbai departs in 3 hours at 09:55 (Asia/Kolkata)! PNR: F8C4UF'), '6E5256')
assert.equal(m.departureFlightCode('✈️ Bengaluru → Mumbai departs in 3 hours at 09:55 (Asia/Kolkata)! PNR: F8C4UF'), '')
assert.equal(m.departureFlightCode('Call 12 3456 people'), '')

const answer = await m.answerLookupReminder('Check Israel election results', { fetcher: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Netanyahu bloc 61 seats with 99% counted (BBC).' }] }), { status: 200 })) as any })
assert.equal(answer, (globalThis as any).process?.env?.ANTHROPIC_API_KEY ? 'Netanyahu bloc 61 seats with 99% counted (BBC).' : null)
const failed = await m.answerLookupReminder('Check Israel election results', { fetcher: (async () => new Response('x', { status: 500 })) as any })
assert.equal(failed, null, 'a failed lookup falls back to the plain reminder')

const t = await import('../lib/services/travel-tickets')
assert.deepEqual(t.legacyReminderTexts({ type: 'flight', fromCity: 'Bengaluru', toCity: 'Mumbai', departLocal: '09:55', pnr: 'F8C4UF' }), ['✈️ Bengaluru → Mumbai departs in 3 hours at 09:55! PNR: F8C4UF'])
const cron = readFileSync('app/api/cron/reminders/route.ts', 'utf8')
assert.match(cron, /if \(jobDone\)/, 'job answers are sent as text')
assert.match(cron, /REMINDER_JOB_TEXT_REFUSED/, 'outside the 24-hour window the template still goes out')
assert.match(cron, /owner && whatsappTo && !topic/, 'only the owner\'s own reminders run lookups')
console.log('✓ 29 Oct: lookup reminders send the answer; flight departure reminders send live status and track')
const style = await import('../lib/bot/handlers/response-style')
assert.equal(style.styleReminderConfirmation("Done — I'll remind you to *Check the Israel election results* today at 8:00 am."), "✅ *Scheduled*\n\nI'll check the Israel election results today at 8:00 am and send you what I find.")
assert.match(style.styleReminderConfirmation("Done — I'll remind you to *Call Nithin* tomorrow at 11:00 am."), /Reminder set/)
console.log('✓ 29 Oct: lookup reminders confirm as a scheduled check')
