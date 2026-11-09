// Open thread (7 Nov live): the "Payment failed · ₹3,398 at Carpe Diem" alert → "It was paid" → "check the mail again and
// track the order". Gogo must read those against its own alert, not ask "What was paid?".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const ot = await import('../lib/agent/open-thread')
const ma = await import('../lib/email/mail-alerts')
const { scoreEmail } = await import('../lib/email/attention')

// 1. Intents from short replies, in order; unrelated text is not a thread reply.
const I = (t: string) => ot.threadIntents(t)
assert.deepEqual(I('It was paid'), ['paid']); assert.deepEqual(I('If was.paid..'), []); assert.deepEqual(I('already paid'), ['paid']); assert.deepEqual(I('I paid it yesterday'), ['paid'])
// A negated payment reply is a correction, NEVER evidence to close the thread as paid.
for (const t of ['I have not paid it', 'It was not settled', 'it is not yet paid', 'No, it has not been paid', 'it was never paid', 'I haven’t paid it', 'it has not cleared']) assert.deepEqual(I(t), [], `negated payment must not be accepted: ${t}`)
assert.deepEqual(I('Check the mail again and track the order..'), ['check', 'track'])
assert.deepEqual(I('open it'), ['open']); assert.deepEqual(I('send me the link'), ['open']); assert.deepEqual(I('send it to me'), ['open'])
// A new instruction while a thread is open is NOT a reply to it: it must reach the brain untouched.
for (const t of ['send an email to Divya about the invoice', 'Send an email to nithin@tipplr.in', 'email Divya the summary', 'message Nithin the link', 'forward this mail to Divya', 'write a mail to my landlord', 'draft a message for Nithin', 'check mail from Nithin', 'any email from Divya today?', 'reply to Divya saying yes', 'text Divya I am late', 'send a note to the team'])
  assert.deepEqual(I(t), [], `command must not be a thread reply: ${t}`)
for (const t of ['open the mail', 'show me the email', 'send me the gmail link', 'check the mail again', 'track it', 'ignore', 'later', 'it was paid', 'thanks']) assert.ok(I(t).length, `still a thread reply: ${t}`)
assert.deepEqual(I('ignore'), ['ignore']); assert.deepEqual(I('stop flagging this'), ['ignore'])
assert.deepEqual(I('remind me at 6pm'), ['later']); assert.deepEqual(I('later'), ['later']); assert.deepEqual(I('tomorrow'), ['later'])
assert.deepEqual(I('what was that?'), ['what']); assert.deepEqual(I('thanks'), ['thanks'])
for (const t of ['remind me to call Divya at 6pm', 'what is the weather', 'book a table at Toit', 'spent 450 on lunch', 'my briefing', 'yes']) assert.deepEqual(I(t), [], `not a thread reply: ${t}`)
console.log('✓ intents: paid, check+track in order, open, ignore, later, what, thanks; ordinary asks untouched')

// 2. The live alert now names the shop, and its thread data carries merchant, amount, sender, ids.
const live = { id: 'm1', threadId: 'abc123def456', from: 'Payment-report <payment-report@payu.in>', subject: 'Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful, Please try again', snippet: 'Payment of Rs.3398.00 failed. Please try again.', date: '2026-11-07T13:10:00+05:30', labels: ['INBOX'] }
const s = scoreEmail(live as any, { now: Date.parse('2026-11-07T13:15:00+05:30') })
const kind = ma.alertKindOf(s)
assert.equal(kind, 'payment_failed')
const text = ma.composeAlert('payment_failed', s, { name: 'Goverdhan', timezone: 'Asia/Kolkata', now: Date.parse('2026-11-07T13:15:00+05:30') } as any)
assert.match(text, /^⚠️ Payment failed\nGoverdhan, your \*₹3398\.00\* payment to \*Carpediem Store\* failed \(Payment-report handles their payments\)\. "Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful, Please try again"\./, text)
assert.equal(ma.merchantFromSubject('Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful, Please try again'), 'Carpediem Store')
assert.equal(ma.merchantFromSubject('Payment to Airtel failed'), 'Airtel'); assert.equal(ma.merchantFromSubject('Welcome aboard'), null)
const data = ma.alertThreadData('payment_failed', s, 'goverdhan.md@gmail.com')
assert.deepEqual([data.merchant, data.amount, data.senderEmail, data.threadId, data.emailId, data.alertKind], ['Carpediem Store', '₹3398.00', 'payment-report@payu.in', 'abc123def456', 'm1', 'payment_failed'])
console.log('✓ the Carpe Diem alert names the shop; thread data carries merchant, amount, sender, ids')

// 3. End to end against a fake DB: the alert opens a thread + a conversation turn; replies resolve against it.
const { supabaseAdmin } = await import('../lib/supabase-admin')
const rows: Record<string, any[]> = { agent_activity: [], conversations: [], reminders: [] }
let seq = 1
;(supabaseAdmin as any).from = (name: string) => {
  const f: [string, any, string][] = []; let patch: any = null, ins: any = null, lim: number | null = null, single = false
  const hit = () => { let r = (rows[name] || []).filter(x => f.every(([k, v, op]) => op === 'gte' ? String(x.created_at) >= String(v) : String(x[k]) === String(v))); r = r.sort((a, b) => b.id - a.id); return lim ? r.slice(0, lim) : r }
  const b: any = { select() { return b }, eq(k: string, v: any) { f.push([k, v, 'eq']); return b }, gte(k: string, v: any) { f.push([k, v, 'gte']); return b }, order() { return b }, limit(n: number) { lim = n; return b }, maybeSingle() { single = true; return b },
    insert(r: any) { ins = r; return b }, update(p: any) { patch = p; return b },
    then(res: any, rej: any) { let out: any[] = []; if (ins) { const row = { id: seq++, created_at: new Date().toISOString(), ...ins }; rows[name].push(row); out = [row] } else if (patch) { out = hit(); out.forEach(r => Object.assign(r, patch)) } else out = hit(); return Promise.resolve({ data: single ? out[0] || null : out, error: null }).then(res, rej) } }
  return b
}
// Gmail and orders are injected.
let mailResults: any[] = []
const deps = { searchMail: async () => mailResults, readOrders: async () => [{ shop: 'Carpediem Store', key: 'cd1', label: 'Carpediem Store order', orderId: 'CD-77', status: 'shipped', expected: '2026-11-09', updated: '2026-11-07T10:00:00Z', problem: false }] }
const actor: any = { userId: 'u', legacyTelegramId: 777, whatsappId: '918884501501', timezone: 'Asia/Kolkata', name: 'Goverdhan' }
await ot.openThread(777, { kind: 'mail_alert', message: text, data })
assert.equal(rows.conversations.length, 1); assert.equal(rows.conversations[0].role, 'assistant'); assert.equal(rows.conversations[0].content, text)
assert.equal(rows.agent_activity.length, 1); assert.equal(rows.agent_activity[0].metadata_json.open, true)
console.log('✓ the alert is now a turn in the conversation and an open thread')

const what = await ot.tryThreadReply(actor, 'what was that?', Date.now(), deps)
assert.match(what!, /^That was this, at \d{1,2}:\d{2} [ap]m:\n⚠️ Payment failed/)
mailResults = [{ id: 'm1', subject: 'Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful, Please try again', snippet: 'failed', date: 'Fri, 7 Nov' }]
const check = await ot.tryThreadReply(actor, 'check the mail again and track the order..', Date.now(), deps)
assert.match(check!, /^Checked again: nothing new from Carpediem Store since that email\.\n\n/, check!)
assert.match(check!, /Carpediem Store order.*CD-77|Carpediem Store/, 'the order section names the shop')
mailResults = [{ id: 'm2', subject: 'Payment received - Order CD-77 confirmed', snippet: 'Thank you for your payment of Rs.3398', date: 'Fri, 7 Nov' }, { id: 'm1', subject: 'Your Order at CARPEDIEM STORE PRIVATE LIMITED is unsuccessful, Please try again', snippet: 'failed', date: 'Fri, 7 Nov' }]
const paid = await ot.tryThreadReply(actor, 'It was paid', Date.now(), deps)
assert.equal(paid, 'Noted: Carpediem Store (₹3398.00) is paid. I can see it: "Payment received - Order CD-77 confirmed". I won\'t flag this one again.', paid!)
assert.equal(rows.agent_activity[0].metadata_json.open, false, 'paid closes the thread')
assert.equal(await ot.tryThreadReply(actor, 'It was paid', Date.now(), deps), null, 'no open thread → ordinary handling')
console.log('✓ what / check + track / paid resolve against the alert; paid closes it')

// Open, later and ignore on a fresh thread.
await ot.openThread(777, { kind: 'mail_alert', message: text, data })
// 8 Nov: the email comes to WhatsApp; a search line for the Gmail app; the web link last and labelled for a computer.
const opened = (await ot.tryThreadReply(actor, 'open it'))!
assert.match(opened, /^\*From:\* /, opened); assert.match(opened, /\*Subject:\* /)
assert.match(opened, /To open it in the Gmail app, paste this into its search bar:\nfrom:\S+@\S+ subject:\(/)
assert.match(opened, /\nOn a computer: https:\/\/mail\.google\.com\/mail\/u\/\?authuser=goverdhan\.md%40gmail\.com#all\/abc123def456$/)
assert.ok(opened.indexOf('*From:*') < opened.indexOf('https://'), 'the email before any link')
// The Cooper case: snippet decoded and quoted, received time, search line.
const coop = ot.openReply({ kind: 'mail_alert', message: '', rowId: 'x', at: '', data: { subject: 'Want some 1:1 help with Cofounder?', sender: 'Cooper Schoenthaler', senderEmail: 'cooper@generalintelligencecompany.com', snippet: "Hi Goverdhan, Thanks for signing up for Cofounder. I'm Cooper", receivedAt: '2026-11-07T15:45:38Z', threadId: '1a1b6afdb1d327fc', gmailEmail: 'goverdhan.md@gmail.com' } } as any)
assert.equal(coop, `*From:* Cooper Schoenthaler <cooper@generalintelligencecompany.com>\n*Subject:* Want some 1:1 help with Cofounder?\n*Received:* ${new Date('2026-11-07T15:45:38Z').toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}\n\n"Hi Goverdhan, Thanks for signing up for Cofounder. I'm Cooper"\n\nTo open it in the Gmail app, paste this into its search bar:\nfrom:cooper@generalintelligencecompany.com subject:(Want some help with Cofounder)\n\nOn a computer: https://mail.google.com/mail/u/?authuser=goverdhan.md%40gmail.com#all/1a1b6afdb1d327fc`, coop)
assert.match(ot.openReply({ kind: 'order_alert', message: '', data: {} } as any), /^I don't have the details/)
const later = await ot.tryThreadReply(actor, 'remind me at 9pm', Date.parse('2026-11-07T13:20:00+05:30'))
assert.match(later!, /^I'll bring it back Sat,? 9:00 pm\.$/, later!)
assert.equal(rows.reminders.length, 1); assert.match(rows.reminders[0].message, /^Email: ⚠️ Payment failed/)
await ot.openThread(777, { kind: 'order_alert', message: '📦 Order update: your Philips WiZ order is out for delivery today.', data: { orderShop: 'Amazon', merchant: 'Amazon', subject: 'PHILIPS WiZ Neo' } })
assert.equal(await ot.tryThreadReply(actor, 'ignore'), "Okay, dropping it. I won't mention Amazon again.")
console.log('✓ open → the email in WhatsApp + Gmail-app search line + computer link; later → reminder; ignore → closed')

// 4. Wiring: deliveries open threads; mail and order steps pass data; both routes try the thread reply before anything else.
const del = readFileSync('lib/agent/watch-alert-delivery.ts', 'utf8'), w = readFileSync('lib/agent/watchers.ts', 'utf8'), wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.match(del, /m\.openThread\(params\.owner, \{ kind: params\.thread\?\.kind \|\| 'watch_alert', message: params\.message/)
assert.match(w, /thread:\{kind:'mail_alert',data:ma\.alertThreadData\(a\.kind,a\.scored/); assert.match(w, /thread:\{kind:'order_alert'/)
assert.ok(wa.indexOf('m.tryThreadReply(') < wa.indexOf('m.tryShared(String(resolvedUser.telegramId), text)'), 'WhatsApp: thread reply before shared content')
assert.ok(dash.indexOf('m.tryThreadReply(actor,text)') < dash.indexOf('m.tryShared(user.telegram_id,text)'), 'dashboard: thread reply before shared content')
console.log('✓ wired: every accepted proactive send opens a thread; replies are tried first on both surfaces')
console.log('Open thread (7 Nov) checks passed')
