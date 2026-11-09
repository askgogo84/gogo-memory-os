// Understand first: a forwarded SMS, bank alert, OTP, delivery update, booking, bill reminder or security notice is
// something the person is SHOWING Gogo, not asking it to do. 6 Nov live: a Kotak payment SMS became a ₹41 split
// expense because the split parser saw "₹41,898" before anything asked what the message was. Instinct read it as a
// payment and offered the one useful next step. This gate runs before every action handler, names what the text
// is, says what it does and does not prove, and makes at most one offer that a "yes" within 30 minutes carries out.
// Nothing here pays, sends or books. A message that leads with an instruction ("split this with Divya",
// "remind me about this") is NOT shared content and falls through to its own handler.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { PAYMENT_GATE, parsePaymentConfirmation, tryPaymentConfirmation, takeReceiptCheck } from './payment-confirmation'
import { attachEvidence, openActionRecord, receiptLine, recordVerification, saveActionRecord, transition } from './action-record'

export type SharedKind = 'payment' | 'bank_debit' | 'bank_credit' | 'otp' | 'delivery' | 'booking' | 'bill_due' | 'security' | 'promo'
export type SharedReading = {
  kind: SharedKind
  sender: string | null
  amount: { value: number; text: string } | null
  date: string | null
  merchant: string | null
  ref: string | null
  /** For deliveries: the status phrase the message used ("out for delivery", "delivered"). */
  detail: string | null
  /** The one offer Gogo makes, or null when there is nothing useful to do. */
  offer: 'log_expense' | 'remind_bill' | 'save_booking' | 'check_order' | null
}

export const SHARED_OFFER_EVENT = 'shared_content_offer'
const YES = /^\s*(?:yes|yeah|yep|yup|ok|okay|sure|please|go ahead|do it|haan|ha|ji|save it|log it|track it|remind me)\b[\s.!]*$/i

// ── what the text is ────────────────────────────────────────────────────────────
/** A message that leads with a request is an instruction, even when it carries pasted content. */
const INSTRUCTION_LEAD = /^\s*(?:(?:hey|hi|gogo|please|pls|can|could|would|will)\s+(?:you\s+|u\s+)?)?(?:remind|split|add|log|save|note|book|track|check|send|forward|reply|draft|cancel|pay|order|find|search|tell|show|explain|what|why|how|when|where|who|is|are|do|does|did|should|translate|summari[sz]e|read|open)\b/i
const INSTRUCTION_TAIL = /(?:^|\n)\s*(?:split|remind|add|log|save|track|book|pay|check|note)\b[^\n]{0,80}$/i
const SENDER_ID = /\b(?:[A-Z]{2}-[A-Z0-9]{5,8}|[A-Z]{2}-[A-Z]{6})\b|^[A-Z]{2}-[A-Z0-9]{3,8}[:\s]/m
const KV_LINE = /(?:^|\n)\s*[A-Za-z][A-Za-z /]{1,30}:\s*\S/g
const INR = /(?:₹|\brs\.?|\binr)\s?([\d,]+(?:\.\d{1,2})?)/i
const DATE = /\b(\d{1,2}[-\/](?:\d{1,2}|[A-Za-z]{3})[-\/]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,?\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|today|tomorrow)\b/i
const REF = /\b(?:utr|upi\s*ref(?:erence)?(?:\s*no\.?)?|ref(?:erence)?\s*(?:no\.?|number|id)|txn\s*(?:id|no\.?)|transaction\s*(?:id|no\.?)|awb|tracking\s*(?:id|no\.?|number)|order\s*(?:id|no\.?|number)|booking\s*(?:id|ref|no\.?)|pnr)\s*[:\-#]?\s*([A-Z0-9\-]{5,30})\b/i

const OTP = /\b(?:otp|one[- ]time\s+(?:password|passcode|pin)|verification\s+code|security\s+code|login\s+code)\b/i
const DEBIT = /\b(?:debited|spent|withdrawn|deducted|charged)\b|\bpaid\s+(?:rs\.?|inr|₹)/i
const CREDIT = /\b(?:credited|received|refund(?:ed)?|deposited|cashback)\b/i
const ACCOUNT = /\b(?:a\/c|acct|account|card)\b.{0,12}(?:x{2,}|\*{2,}|ending|no\.?)?\s*\d{3,6}|\b(?:xx|x{2,}|\*{3,})\d{4}\b/i
const DELIVERY = /\b(?:out\s+for\s+delivery|has\s+been\s+(?:shipped|dispatched|delivered)|is\s+(?:shipped|dispatched|delivered|arriving)|will\s+be\s+delivered|delivery\s+(?:attempt|agent|partner|by|expected)|arriving\s+(?:today|tomorrow|by)|awb|tracking\s+(?:id|number)|shipment)\b/i
const COURIER = /\b(delhivery|bluedart|blue\s+dart|dtdc|ekart|xpressbees|shadowfax|shiprocket|amazon|flipkart|myntra|ajio|meesho|nykaa|india\s+post|speed\s+post|fedex|dhl)\b/i
const BOOKING = /\b(?:pnr|booking\s+(?:id|ref|confirmed|confirmation)|your\s+(?:flight|train|bus|hotel|ticket|seat|table|cab|ride)\s+(?:is\s+)?(?:booked|confirmed)|e-?ticket|boarding\s+pass|check-?in\s+(?:opens|time)|reservation\s+(?:confirmed|id))\b/i
const BILL = /\b(?:bill|invoice|premium|emi|instalment|installment|rent|fee|subscription|recharge)\b.{0,80}\b(?:due|payable|pay\s+by|before|last\s+date|expires?)\b|\b(?:due\s+(?:on|by|date)|is\s+due|payment\s+reminder|pay\s+now\s+to\s+avoid)\b/i
const SECURITY = /\b(?:new\s+(?:sign[- ]?in|login|device)|signed\s+in\s+(?:from|on)|password\s+(?:was\s+)?(?:changed|reset)|unusual\s+(?:activity|sign[- ]?in)|security\s+alert|was\s+granted\s+access|allowed\s+\S+\s+access|verify\s+it'?s\s+you)\b/i
const PROMO = /\b(?:\d{1,2}%\s+off|flat\s+(?:rs\.?|₹)?\s?\d+\s+off|use\s+code|coupon|sale\s+(?:is\s+)?(?:live|ends)|limited\s+(?:time|period)\s+offer|t&c\s+apply|unsubscribe|opt[- ]out|to\s+stop\s+(?:sms|msgs)|reply\s+stop)\b/i

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(Hdfc|Icici|Sbi|Idfc|Pnb|Axis|Kotak|Upi|Emi|Otp|Ltd|Pvt)\b/g, m => m.toUpperCase())

/** Who sent it, from a bank/brand signature ("-HDFC Bank", "Team Swiggy", "Regards, Airtel") or a sender id. Pure. */
export function senderOf(text: string): string | null {
  const sig = text.match(/(?:^|\n|\.|\s)[-–—]\s*([A-Z][A-Za-z&' ]{2,30}?)\s*(?:\n|$)/) || text.match(/\b(?:team|regards,?|thanks,?|from)\s+([A-Z][A-Za-z&' ]{2,30}?)(?:[.!\n]|$)/i)
  if (sig) return clean(sig[1])
  const bank = text.match(/\b(HDFC|ICICI|SBI|Axis|Kotak|IDFC|Yes|IndusInd|PNB|BOB|Canara|Federal|AU)\s+Bank\b/i)
  if (bank) return `${bank[1].toUpperCase().length <= 4 ? bank[1].toUpperCase() : titleCase(bank[1])} Bank`
  const brand = text.match(COURIER) || text.match(/\b(Swiggy|Zomato|Zepto|Blinkit|Airtel|Jio|Vi|BESCOM|BBMP|BWSSB|Tata\s+Power|Cred|PhonePe|Paytm|Google\s+Pay|BookMyShow|IRCTC|MakeMyTrip|Cleartrip|Goibibo|IndiGo|Air\s+India|Vistara|Akasa|Uber|Ola|Rapido|Dunzo|Practo|Apollo|Netflix|Spotify|Hotstar|Prime\s+Video|Google|Microsoft|Apple|WhatsApp|Instagram|LinkedIn|Amazon\s+Pay|SBI\s+Card|Bajaj\s+Finserv)\b/i)
  return brand ? titleCase(brand[1]) : null
}

/** The merchant a debit went to ("to SWIGGY", "at AMAZON", "towards Airtel"). Pure. */
function merchantOf(text: string): string | null {
  const m = text.match(/\b(?:to|at|towards|for|from|by|paid\s+to|merchant)\s+(?:vpa\s+)?([A-Z][A-Za-z0-9@.&'\-]{2,40}(?:\s+[A-Z][A-Za-z0-9&'\-]{0,20}){0,3})(?=\s+(?:on|via|using|ref|upi|dated|dt)\b|[.,;]|$)/)
  if (!m) return null
  const v = clean(m[1]).replace(/@.*$/, '')
  return /^(?:your|the|a|an|this|that|rs|inr|upi|ac|a\/c)$/i.test(v) ? null : titleCase(v)
}

/** Does the text look like something pasted or forwarded, rather than typed to Gogo? Pure. */
export function looksShared(text: string): boolean {
  const t = String(text || '')
  if (t.trim().length < 40 || t.length > 2500) return false
  if (INSTRUCTION_LEAD.test(t) || INSTRUCTION_TAIL.test(t)) return false
  if (/\?\s*$/.test(t.trim())) return false
  let score = 0
  if ((t.match(KV_LINE) || []).length >= 2) score += 2
  if (SENDER_ID.test(t)) score += 2
  if (/\bdear\s+(?:customer|sir|madam|user|member|[A-Z][a-z]+)\b/i.test(t)) score += 2
  if (ACCOUNT.test(t)) score += 1
  if (INR.test(t)) score += 1
  if (DATE.test(t)) score += 1
  if (REF.test(t)) score += 1
  if (/(?:^|\n|\s)[-–—]\s*[A-Z][A-Za-z&' ]{2,30}\s*$/m.test(t) || /\b(?:team|regards)\s+[A-Z]/i.test(t)) score += 1
  if (/https?:\/\/\S+|\bbit\.ly\b|\bt\.co\b/i.test(t)) score += 1
  if (/\b(?:do\s+not\s+share|never\s+share|t&c|terms\s+apply|for\s+assistance|call\s+\d{4,}|toll[- ]free)\b/i.test(t)) score += 1
  if (/\b(?:you|your)\b/i.test(t) && !/\b(?:i|me|my|we)\b/i.test(t)) score += 1
  if (/\b(?:if\s+(?:this\s+)?(?:was|wasn'?t|not)\s+you|not\s+you\?|no\s+action\s+(?:needed|required)|ignore\s+if|valid\s+for\s+\d+)\b/i.test(t)) score += 1
  if (/\b(?:t&c|reply\s+stop|opt[- ]out|unsubscribe|use\s+code)\b/i.test(t)) score += 2
  if (senderOf(t)) score += 1
  return score >= 3
}

/** What a shared message is. Null when it is not shared content, or is shared content of no known kind. Pure. */
export function readShared(raw: string): SharedReading | null {
  const text = String(raw || '')
  if (!looksShared(text)) return null
  const flat = clean(text)
  const amtM = flat.match(INR)
  const amount = amtM && Number.isFinite(Number(amtM[1].replace(/,/g, ''))) && Number(amtM[1].replace(/,/g, '')) > 0 ? { value: Number(amtM[1].replace(/,/g, '')), text: `₹${amtM[1]}` } : null
  const base = { sender: senderOf(text), amount, date: flat.match(DATE)?.[1] || null, merchant: null as string | null, ref: flat.match(REF)?.[1] || null, detail: null as string | null }
  if (OTP.test(flat) && /\b\d{4,8}\b/.test(flat)) return { kind: 'otp', ...base, offer: null }
  if (SECURITY.test(flat)) return { kind: 'security', ...base, offer: null }
  if (amount && DEBIT.test(flat) && (ACCOUNT.test(flat) || /\b(?:upi|imps|neft|netbanking|net\s+banking|card)\b/i.test(flat)) && !CREDIT.test(flat) && !/\b(?:payment\s+status|merchant\s+name)\b/i.test(flat)) return { kind: 'bank_debit', ...base, merchant: merchantOf(flat), offer: 'log_expense' }
  if (amount && CREDIT.test(flat) && (ACCOUNT.test(flat) || /\b(?:upi|imps|neft|refund)\b/i.test(flat))) return { kind: 'bank_credit', ...base, merchant: merchantOf(flat), offer: null }
  if (PAYMENT_GATE.test(flat) && parsePaymentConfirmation(flat)) return { kind: 'payment', ...base, offer: null }
  if (DELIVERY.test(flat) || (COURIER.test(flat) && /\b(?:order|parcel|package|shipment)\b/i.test(flat))) return { kind: 'delivery', ...base, merchant: flat.match(COURIER)?.[1] ? titleCase(flat.match(COURIER)![1]) : null, detail: flat.match(/\b(out for delivery|delivered|shipped|dispatched|arriving (?:today|tomorrow)|delivery attempt(?:ed)?)\b/i)?.[1]?.toLowerCase() || null, offer: 'check_order' }
  if (BOOKING.test(flat)) return { kind: 'booking', ...base, offer: 'save_booking' }
  if (BILL.test(flat) && (amount || base.date)) return { kind: 'bill_due', ...base, offer: base.date ? 'remind_bill' : null }
  if (PROMO.test(flat)) return { kind: 'promo', ...base, offer: null }
  return null
}

// ── what Gogo says ───────────────────────────────────────────────────────────────
export const OFFER_QUESTION: Record<NonNullable<SharedReading['offer']>, string> = {
  log_expense: 'Want me to log it as an expense?',
  remind_bill: 'Want a reminder the day before?',
  save_booking: 'Want me to save it and remind you before you leave?',
  check_order: 'Want me to check your email for the latest on it?',
}

/** The reply for a shared message: what it is, what it does not prove, one offer. Pure. */
export function sharedReply(r: SharedReading, name?: string | null): string {
  const who = r.sender || r.merchant || 'The sender'
  const amt = r.amount ? `*${r.amount.text}*` : 'an amount'
  const on = r.date ? (/^(?:today|tomorrow)$/i.test(r.date) ? ` ${r.date.toLowerCase()}` : ` on ${r.date}`) : ''
  let body = ''
  switch (r.kind) {
    case 'otp': body = `That's a one-time code${r.sender ? ` from ${r.sender}` : ''}. I don't save these, and no one from AskGogo will ever ask you for one.`; break
    case 'security': body = `${who} is reporting a security event${on}. If that was you, nothing to do. If not, change the password on their site and check the connected apps and devices. I can't tell from the message whether it was you.`; break
    case 'delivery': body = `${who} says a parcel is ${r.detail || 'on its way'}${on}${r.ref ? ` (ref ${r.ref})` : ''}. The message doesn't say which order, so I can't tell if it's the one you're waiting for.`; break
    case 'booking': body = `That's a booking confirmation${r.sender ? ` from ${r.sender}` : ''}${r.ref ? `, ref ${r.ref}` : ''}${on}. It confirms the booking, not that payment has settled; check your bank's message for that.`; break
    case 'bank_debit': body = `${who} says ${amt} left your account${r.merchant ? ` to ${r.merchant}` : ''}${on}. That's the bank's side; it doesn't by itself confirm ${r.merchant || 'the merchant'} received it.`; break
    case 'bank_credit': body = `${who} says ${amt} came into your account${r.merchant ? ` from ${r.merchant}` : ''}${on}. Nothing to do.`; break
    case 'bill_due': body = `${who} says ${r.amount ? amt : 'a bill'} is due${r.date ? ` ${/^(?:today|tomorrow)$/i.test(r.date) ? r.date.toLowerCase() : `on ${r.date}`}` : ''}. I can't tell from this whether it's already paid.`; break
    case 'promo': body = `That's a promotion${r.sender ? ` from ${r.sender}` : ''}. Nothing to do unless you want it.`; break
    default: body = `That reads as a message from ${who}.`
  }
  const question = r.offer ? OFFER_QUESTION[r.offer] : null
  return [body.replace(/\s{2,}/g, ' ').trim(), question].filter(Boolean).join('\n\n')
}

// ── the gate and the "yes" ───────────────────────────────────────────────────────
/** A shared message → its reply, with the offer saved for a "yes". Payment confirmations keep their own flow. */
export async function tryShared(telegramId: string | number, text: string): Promise<string | null> {
  const r = readShared(text)
  if (!r) return null
  if (r.kind === 'payment') return tryPaymentConfirmation(telegramId, text)
  const reply = sharedReply(r)
  console.log('SHARED_CONTENT:', JSON.stringify({ kind: r.kind, sender: r.sender, amount: r.amount?.value ?? null, offer: r.offer }))
  if (r.offer) {
    await supabaseAdmin.from('agent_activity').insert({ telegram_id: String(telegramId), event_type: SHARED_OFFER_EVENT, message: `${r.kind}: ${r.sender || r.merchant || ''}`.trim(), metadata_json: { reading: r, text: String(text).slice(0, 1500), question: OFFER_QUESTION[r.offer], open: true } })
      .then(({ error }) => { if (error) console.error('SHARED_OFFER_SAVE_FAILED:', error.message) })
  }
  return reply
}

/** The day before a "5 Nov"/"05-11-2026" date at 9 am in the person's zone, or null. Pure enough. */
export function dayBeforeAt9(dateText: string, now: number, tz: string): string | null {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const y0 = new Date(now).getFullYear()
  let d: number | undefined, m: number | undefined, y: number | undefined
  const a = dateText.match(/^(\d{1,2})[-\/](\d{1,2}|[A-Za-z]{3})[-\/](\d{2,4})$/), b = dateText.match(/^(\d{1,2})\s+([A-Za-z]+)(?:,?\s+(\d{4}))?$/), c = dateText.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)
  if (/^tomorrow$/i.test(dateText)) { const t = new Date(now + 86_400_000); d = t.getDate(); m = t.getMonth(); y = t.getFullYear() }
  else if (a) { d = Number(a[1]); m = /\d/.test(a[2]) ? Number(a[2]) - 1 : months.indexOf(a[2].toLowerCase()); y = Number(a[3].length === 2 ? `20${a[3]}` : a[3]) }
  else if (b) { d = Number(b[1]); m = months.indexOf(b[2].slice(0, 3).toLowerCase()); y = b[3] ? Number(b[3]) : undefined }
  else if (c) { d = Number(c[2]); m = months.indexOf(c[1].slice(0, 3).toLowerCase()); y = c[3] ? Number(c[3]) : undefined }
  if (d === undefined || m === undefined || m < 0) return null
  const offsetMin = tz === 'Asia/Kolkata' ? 330 : -new Date(now).getTimezoneOffset()
  const build = (yy: number) => Date.UTC(yy, m!, d! - 1, 9, 0) - offsetMin * 60_000
  let at = build(y ?? y0)
  if (y === undefined && at < now) at = build(y0 + 1)
  return at > now ? new Date(at).toISOString() : null
}

/** "Yes" to a shared-content offer (Gogo's latest message, within 30 min) → the one thing offered. */
export async function takeSharedOffer(actor: AgentActor, text: string): Promise<string | null> {
  if (!YES.test(text)) return null
  const tg = String(actor.legacyTelegramId)
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const [{ data: events }, { data: last }] = await Promise.all([
    supabaseAdmin.from('agent_activity').select('id,metadata_json').eq('telegram_id', tg).eq('event_type', SHARED_OFFER_EVENT).gte('created_at', since).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('conversations').select('content').eq('telegram_id', tg).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1),
  ])
  const row: any = events?.[0]
  const latest = String((last as any)?.[0]?.content || '').trim()
  if (!row?.metadata_json?.open || !latest.endsWith(String(row.metadata_json.question))) return null
  const r = row.metadata_json.reading as SharedReading, original = String(row.metadata_json.text || '')
  await supabaseAdmin.from('agent_activity').update({ metadata_json: { ...row.metadata_json, open: false } }).eq('id', row.id).then(() => {}, () => {})
  const tz = actor.timezone || 'Asia/Kolkata'
  try {
    if (r.offer === 'log_expense' && r.amount) {
      const { saveExpense } = await import('@/lib/bot/services/expense-storage')
      const description = r.merchant || r.sender || 'Bank debit'
      // One action record: request → policy (lists, low risk, reversible → auto) → the row → read back → receipt.
      let rec = transition(openActionRecord({ telegramId: tg, capability: 'lists', action: 'expense.log', request: text, policy: { capability: 'lists', permissionLevel: 'auto', mode: 'execute', risk: 'low', irreversible: false } }), 'running')
      const saved = await saveExpense({ telegramId: actor.legacyTelegramId, whatsappId: actor.whatsappId || null, expense: { amount: r.amount.value, category: 'other', description, rawText: original.slice(0, 500) } as any })
      if (saved?.id) {
        rec = attachEvidence(rec, { provider: 'supabase.expenses', ids: { id: String(saved.id) } })
        const { data: back } = await supabaseAdmin.from('expenses').select('id,amount').eq('id', saved.id).maybeSingle()
        rec = recordVerification(rec, back?.id ? { state: 'verified_completed', evidence: { id: String(back.id), amount: back.amount } } : { state: 'still_unknown', evidence: {}, reason: 'read_back_missing' })
      } else rec = transition(rec, 'failed', { error: 'expense_insert_failed' })
      await saveActionRecord(supabaseAdmin, rec)
      return `${receiptLine(rec, `${r.amount.text} logged as ${description}`)}${rec.state === 'verified_success' ? ' Say "expenses today" to see the day.' : ''}`
    }
    if (r.offer === 'remind_bill' && r.date) {
      const at = dayBeforeAt9(r.date, Date.now(), tz)
      if (!at) return `That date has already passed, so there's nothing to remind you about. Say "remind me to pay ${r.sender || 'it'} tomorrow at 9am" if you still want one.`
      const message = `${r.sender || 'A bill'}${r.amount ? ` ${r.amount.text}` : ''} is due ${/^(?:today|tomorrow)$/i.test(r.date) ? 'tomorrow' : `on ${r.date}`}.`
      let rec = transition(openActionRecord({ telegramId: tg, capability: 'reminders', action: 'reminder.create', request: text, policy: { capability: 'reminders', permissionLevel: 'auto', mode: 'execute', risk: 'low', irreversible: false } }), 'running')
      const { data: ins, error } = await supabaseAdmin.from('reminders').insert({ telegram_id: actor.legacyTelegramId, chat_id: actor.legacyTelegramId, message, remind_at: at, sent: false, timezone: tz, whatsapp_to: actor.whatsappId || null }).select('id').single()
      if (error || !ins?.id) rec = transition(rec, 'failed', { error: String(error?.message || 'reminder_insert_failed').slice(0, 80) })
      else {
        rec = attachEvidence(rec, { provider: 'supabase.reminders', ids: { id: String(ins.id) } })
        const { data: back } = await supabaseAdmin.from('reminders').select('id,remind_at').eq('id', ins.id).maybeSingle()
        rec = recordVerification(rec, back?.id ? { state: 'verified_completed', evidence: { id: String(back.id), remindAt: back.remind_at } } : { state: 'still_unknown', evidence: {}, reason: 'read_back_missing' })
      }
      await saveActionRecord(supabaseAdmin, rec)
      const when = new Date(at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz })
      return `${receiptLine(rec, `reminder for ${when}`)}${rec.state === 'verified_success' ? ` ${message}` : ''}`
    }
    if (r.offer === 'save_booking') {
      const { parseFlightTicketTextSafe } = await import('@/lib/services/pdf-reader-whatsapp')
      const info = parseFlightTicketTextSafe(original)
      if (!info) return "I couldn't read the flight details from that text. Send the ticket PDF or screenshot and I'll save it with reminders."
      const { persistAndRemindTicket } = await import('@/lib/services/travel-tickets')
      const res = await persistAndRemindTicket(info, { telegramId: actor.legacyTelegramId, whatsappTo: actor.whatsappId ? `whatsapp:${actor.whatsappId.replace(/^whatsapp:/, '')}` : '', timezone: tz, source: 'text' } as any)
      return res.reply
    }
    if (r.offer === 'check_order') {
      const { tryOrderList } = await import('./order-tracking')
      return (await tryOrderList(actor, 'track my orders')) || "I couldn't find recent order emails. Connect Gmail in Connections and I'll track them."
    }
  } catch (err: any) {
    console.error('SHARED_OFFER_FAILED:', String(err?.message || err).slice(0, 160))
    return "I couldn't do that just now. Try again in a minute."
  }
  return null
}

/** Both follow-ups in one call for the routes: the shared-content "yes" first, then the receipt "yes". */
export async function takeSharedFollowUp(actor: AgentActor, text: string): Promise<string | null> {
  return (await takeSharedOffer(actor, text)) || takeReceiptCheck(actor, text)
}
