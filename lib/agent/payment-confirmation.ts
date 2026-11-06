// A forwarded payment confirmation (bank, UPI, gateway SMS), 6 Nov live: "Payment Status: SUCCESS, Merchant Name:
// KOTAK MAHINDRA PRIME LIMITED, Amount: ₹41,898.00 …" became a ₹41 split expense ("Expense added to With Amount").
// Instinct read it as what it is: a payment, with the caveat that the merchant's own credit is a separate thing,
// and offered to look for the merchant's receipt in Gmail. This does the same. Read-only; nothing is paid.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export type PaymentConfirmation = {
  status: 'success' | 'failed' | 'pending'
  merchant: string
  amount: number
  amountText: string
  payer: string | null
  bank: string | null
  accountLast4: string | null
  transactionId: string | null
  reference: string | null
  mode: string | null
}

const AMOUNT = /(?:amount|amt|paid|payment\s+of|rs\.?|inr|₹)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[,;]\s*$/, '').trim()
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(Ltd|Pvt|Llp|Upi|Emi|Hdfc|Icici|Sbi|Idfc|Pnb)\b/g, m => m.toUpperCase()).replace(/\bLimited\b/, 'Limited')

/** The payment a forwarded confirmation describes, or null when the text is not one. Pure. */
export function parsePaymentConfirmation(raw: string): PaymentConfirmation | null {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (text.length < 30 || text.length > 1500) return null
  const idRe = /\b(?:transaction\s*(?:id|no\.?|number|ref(?:erence)?)|txn\s*(?:id|no\.?|ref)|utr(?:\s*no\.?)?|upi\s*ref(?:erence)?(?:\s*no\.?)?|ref(?:erence)?\s*(?:no\.?|number|id)|order\s*(?:id|no\.?)|rrn)\s*[:\-#]?\s*([A-Z0-9]{8,30})/gi
  const ids: { kind: string; value: string }[] = []
  for (const m of text.matchAll(idRe)) ids.push({ kind: m[0].split(/\s*[:\-#]\s*/)[0].toLowerCase(), value: m[1] })
  const statusM = text.match(/\b(?:payment\s+)?status\s*[:\-]?\s*(success(?:ful)?|completed|failed|failure|declined|pending|processing)\b/i)
    || text.match(/\b(paid\s+successfully|payment\s+(?:was\s+)?successful|successfully\s+(?:paid|debited|transferred)|transaction\s+successful|payment\s+failed|transaction\s+failed|declined|failed|unsuccessful|debited|has\s+been\s+paid|you\s+have\s+paid)\b/i)
  const amountM = text.match(AMOUNT)
  const hasShape = ids.length > 0 || !!statusM
  if (!amountM || !hasShape) return null
  const amount = Number(amountM[1].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const merchantM = text.match(/\b(?:merchant(?:\s+name)?|payee(?:\s+name)?|beneficiary(?:\s+name)?|to|paid\s+to|towards)\s*[:\-]?\s*([A-Z][A-Za-z0-9&'()\- ]{2,60}?)(?=\s*[,.;]|\s+(?:amount|amt|rs\.?|inr|₹|on|via|from|using|ref|utr|txn|transaction|upi|failed|successful|is|was|has|not)\b|$)/i)
  const merchant = merchantM ? clean(merchantM[1]).replace(/\s+(?:limited|ltd\.?|pvt\.?\s*ltd\.?|private\s+limited|llp)$/i, '') : null
  if (!merchant || /^(?:your|the|my|a|an|me|you)$/i.test(merchant)) return null
  const payer = text.match(/\b(?:paid\s+by|payer(?:\s+name)?|from\s+name)\s*[:\-]?\s*([A-Z][A-Za-z .'-]{2,60}?)(?=\s*,|\s+(?:amount|a\/c|account|savings|bank)\b|$)/i)?.[1] || null
  const bank = text.match(/\b(HDFC|ICICI|SBI|State Bank|Axis|Kotak(?:\s+Mahindra)?\s+Bank|IDFC(?:\s+First)?|Yes Bank|IndusInd|PNB|Punjab National|Bank of Baroda|Canara|Union Bank|Federal|RBL|Paytm Payments Bank|Airtel Payments Bank)\b/i)?.[1] || null
  const last4 = text.match(/(?:a\/c|account|acct|card)[^0-9*xX]{0,20}[*xX]{2,}\s?(\d{4})\b|[*xX]{4,}(\d{4})\b/i)
  const mode = text.match(/\b(UPI|IMPS|NEFT|RTGS|net\s*banking|netbanking|debit\s+card|credit\s+card|wallet|autopay|e-?mandate)\b/i)?.[1] || null
  const s = (statusM?.[1] || '').toLowerCase()
  const status: PaymentConfirmation['status'] = /fail|declin|unsuccess/.test(s) ? 'failed' : /pend|process/.test(s) ? 'pending' : 'success'
  const pick = (re: RegExp) => ids.find(i => re.test(i.kind))?.value || null
  return {
    status, merchant: titleCase(merchant), amount, amountText: `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`,
    payer: payer ? titleCase(clean(payer)) : null, bank: bank ? bank.toUpperCase() === bank ? bank : titleCase(bank) : null,
    accountLast4: last4 ? last4[1] || last4[2] : null,
    transactionId: pick(/transaction|txn|utr|upi|rrn/), reference: [pick(/^ref|order/), ...ids.map(i => i.value)].find(v => v && v !== pick(/transaction|txn|utr|upi|rrn/)) || null, mode: mode ? mode.toUpperCase().replace(/\s+/g, ' ') : null,
  }
}

const LENDER = /\b(?:prime|finance|financial|loan|capital|credit|housing|emi|bajaj|home\s+loan|lending|nbfc)\b/i
const UTILITY = /\b(?:bescom|electric|power|water|gas|broadband|fibre|fiber|airtel|jio|vi\b|vodafone|bsnl|act\b|tata\s+play|dth)\b/i
const TAX = /\b(?:income\s+tax|gst|cbdt|tin|property\s+tax|bbmp|rto|parivahan|challan)\b/i

export const RECEIPT_QUESTION = 'Want me to check for their receipt in your email?'
export const RECEIPT_OFFER_EVENT = 'payment_receipt_offer'

/** The reply to a forwarded confirmation: what it shows, what it does not prove, one question. Pure. */
export function confirmationReply(p: PaymentConfirmation): string {
  const acct = p.bank ? `${p.bank}${p.accountLast4 ? ` …${p.accountLast4}` : ''}` : p.accountLast4 ? `account …${p.accountLast4}` : null
  const via = [acct ? `from ${acct}` : null, p.mode ? `via ${p.mode}` : null].filter(Boolean).join(' ')
  if (p.status === 'failed') return `This shows a *failed* payment of ${p.amountText} to ${p.merchant}${via ? ` (${via})` : ''}. Nothing was paid; if money left your account, the bank usually reverses it within a few days.${p.reference ? ` Reference: ${p.reference}.` : ''}`
  if (p.status === 'pending') return `This shows a ${p.amountText} payment to ${p.merchant} still *pending*${via ? ` (${via})` : ''}. I'd wait for the final status before paying again.${p.reference ? ` Reference: ${p.reference}.` : ''}`
  const what = LENDER.test(p.merchant) ? `${p.merchant} has credited it against your loan` : TAX.test(p.merchant) ? `it has been applied to your account` : UTILITY.test(p.merchant) ? `${p.merchant} has updated your account` : `${p.merchant} has recorded it on their side`
  return `The confirmation shows ${p.amountText} paid successfully to ${p.merchant}${via ? ` ${via}` : ''}. It doesn't by itself confirm ${what}.\n\n${RECEIPT_QUESTION}`
}

/** Searchable facts for the Gmail check. Pure. */
export function receiptQuery(p: PaymentConfirmation): string {
  const words = p.merchant.split(/\s+/).filter(w => w.length > 2 && !/^(?:limited|ltd|pvt|private|the|and)$/i.test(w)).slice(0, 2).map(w => `"${w}"`).join(' ')
  const digits = String(Math.round(p.amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const refs = [p.reference, p.transactionId].filter(Boolean).map(r => `"${r}"`)
  return `(${[`"${digits}"`, `"${Math.round(p.amount)}"`, ...refs].join(' OR ')}) ${words} newer_than:10d -in:spam`
}

type Mail = { from: string; subject: string; snippet?: string; date?: string }
// Payment gateways and UPI apps. A bank's own debit alert is the forwarded SMS again, not a receipt.
const GATEWAY = /\b(?:ccavenue|razorpay|payu|billdesk|paytm|phonepe|gpay|google\s*pay|cashfree|instamojo|juspay|stripe|npci|bharatpe|amazon\s*pay)\b/i
/** Reads what the emails prove. Pure. */
export function receiptVerdict(p: PaymentConfirmation, mails: Mail[]): string {
  const words = p.merchant.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(?:limited|ltd|pvt|private|the|and)$/.test(w))
  const amountRe = new RegExp(String(Math.round(p.amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',?'))
  const about = mails.filter(m => amountRe.test(`${m.subject} ${m.snippet || ''}`) || [p.reference, p.transactionId].some(r => r && `${m.subject} ${m.snippet || ''}`.includes(r)))
  const merchantMail = about.find(m => words.some(w => m.from.toLowerCase().includes(w)) || /\b(?:receipt|credited|received|acknowledg|emi\s+received|payment\s+received|thank you for (?:your )?payment)\b/i.test(`${m.subject} ${m.snippet || ''}`) && !GATEWAY.test(m.from))
  const gatewayMail = about.find(m => GATEWAY.test(`${m.from} ${m.subject}`) && m !== merchantMail)
  const line = (m: Mail) => `${m.from.replace(/\s*<[^>]+>/, '').replace(/^"|"$/g, '')}: "${m.subject.replace(/\s+/g, ' ').slice(0, 90)}"`
  if (merchantMail) return `Found it. ${line(merchantMail)}. That's ${p.merchant}'s own confirmation of the ${p.amountText}, so this payment is settled on their side too.${gatewayMail ? `\nThe gateway confirmation is there as well (${line(gatewayMail)}).` : ''}`
  if (gatewayMail) return `Found the gateway confirmation: ${line(gatewayMail)}: ${p.amountText} to ${p.merchant}, payment successful.\n\nNo receipt from ${p.merchant} itself yet. The payment succeeded at the gateway; ${LENDER.test(p.merchant) ? 'the loan credit' : 'their side'} is still unconfirmed. They usually send one within a day or two; say "check again tomorrow" and I'll look.`
  if (about.length) return `I found ${about.length} email${about.length === 1 ? '' : 's'} mentioning ${p.amountText}, but none from ${p.merchant} or a payment gateway about this payment. ${line(about[0])}.`
  return `No email about this ${p.amountText} payment to ${p.merchant} in the last 10 days, from them or a payment gateway. The bank confirmation you forwarded is the only record so far. Say "check again tomorrow" and I'll look again.`
}

export const PAYMENT_GATE = /\b(?:payment\s+status|merchant\s+name|transaction\s+(?:id|no|ref)|txn\s+(?:id|no|ref)|utr|upi\s+ref|reference\s+(?:no|number)|paid\s+successfully|payment\s+(?:was\s+)?successful|successfully\s+(?:paid|debited))\b/i

/** A forwarded confirmation → the reply, with the receipt offer saved for a "yes". */
export async function tryPaymentConfirmation(telegramId: string | number, text: string): Promise<string | null> {
  if (!PAYMENT_GATE.test(text)) return null
  const p = parsePaymentConfirmation(text)
  if (!p) return null
  const reply = confirmationReply(p)
  const tg = String(telegramId)
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: RECEIPT_OFFER_EVENT, message: `${p.amountText} to ${p.merchant}`, metadata_json: { payment: p, question: RECEIPT_QUESTION, open: p.status === 'success' } }).then(({ error }) => { if (error) console.error('PAYMENT_OFFER_SAVE_FAILED:', error.message) })
  console.log('PAYMENT_CONFIRMATION:', JSON.stringify({ status: p.status, merchant: p.merchant, amount: p.amount, mode: p.mode }))
  return reply
}

/** "Yes" to the receipt question (Gogo's latest message, within 30 min) → the Gmail check. */
export async function takeReceiptCheck(actor: AgentActor, text: string): Promise<string | null> {
  if (!/^\s*(?:yes|yeah|yep|yup|ok|okay|sure|please|go ahead|do it|check|check it|haan|ha|ji)\b[\s.!]*$/i.test(text)) return null
  const tg = String(actor.legacyTelegramId)
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const [{ data: events }, { data: last }] = await Promise.all([
    supabaseAdmin.from('agent_activity').select('id,metadata_json').eq('telegram_id', tg).eq('event_type', RECEIPT_OFFER_EVENT).gte('created_at', since).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('conversations').select('content').eq('telegram_id', tg).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1),
  ])
  const row: any = events?.[0]
  const latest = String((last as any)?.[0]?.content || '').trim()
  if (!row?.metadata_json?.open || !latest.endsWith(RECEIPT_QUESTION)) return null
  const p = row.metadata_json.payment as PaymentConfirmation
  await supabaseAdmin.from('agent_activity').update({ metadata_json: { ...row.metadata_json, open: false } }).eq('id', row.id).then(() => {}, () => {})
  try {
    const { searchWorkspaceEmailsByQuery } = await import('./google-workspace-read')
    const mails = (await searchWorkspaceEmailsByQuery(actor, receiptQuery(p), 8)) as Mail[]
    console.log('PAYMENT_RECEIPT_CHECK:', JSON.stringify({ merchant: p.merchant, found: mails.length }))
    return receiptVerdict(p, mails)
  } catch (err: any) {
    const code = String(err?.message || err)
    if (/workspace_not_connected|workspace_reconnect_required|workspace_scope_required/.test(code)) return 'Connect Gmail in Connections and I can look for the receipt.'
    if (code.includes('workspace_email_reading_disabled')) return 'Gmail is connected, but email reading is turned off in your privacy setting, so I did not look.'
    console.error('PAYMENT_RECEIPT_CHECK_FAILED:', code.slice(0, 120))
    return "I couldn't read your Gmail just now. Try again in a minute."
  }
}
