// The thread behind a proactive message. 7 Nov live: Gogo alerted "Payment failed · ₹3,398 at Carpe Diem" at 6:45,
// the person replied "It was paid" and then "check the mail again and track the order", and the brain had no idea what
// "it" was, because the alert went out through the watcher and never entered the conversation. Now every proactive
// send (a) is written into the conversation as Gogo's own turn, so the brain has it, and (b) opens a thread for two
// hours, so short replies are read against it deterministically: paid, check again, track, open, ignore, later, what.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export const OPEN_THREAD_EVENT = 'open_thread'
export const THREAD_TTL_MS = 2 * 3_600_000
export type ThreadKind = 'mail_alert' | 'order_alert' | 'watch_alert' | 'reminder' | 'briefing'
export type OpenThread = {
  kind: ThreadKind
  /** The text the person saw. */
  message: string
  /** What the message was about, as far as the sender knew. All optional; the reply handler uses what is there. */
  data: { subject?: string | null; sender?: string | null; senderEmail?: string | null; merchant?: string | null; amount?: string | null; threadId?: string | null; emailId?: string | null; alertKind?: string | null; gmailEmail?: string | null; orderShop?: string | null; snippet?: string | null; receivedAt?: string | null }
  at: string
}

/** Call after a proactive send is accepted. Writes the turn into the conversation and opens the thread. */
export async function openThread(telegramId: string | number, thread: Omit<OpenThread, 'at'>): Promise<void> {
  const tg = String(telegramId)
  const at = new Date().toISOString()
  const owner = Number(tg)
  await Promise.all([
    Number.isSafeInteger(owner) ? supabaseAdmin.from('conversations').insert({ telegram_id: owner, role: 'assistant', content: thread.message }).then(({ error }: any) => { if (error) console.error('OPEN_THREAD_CONVERSATION_FAILED:', error.message) }, () => {}) : Promise.resolve(),
    supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: OPEN_THREAD_EVENT, message: `${thread.kind}: ${(thread.data.subject || thread.data.merchant || '').slice(0, 80)}`, metadata_json: { ...thread, at, open: true } }).then(({ error }: any) => { if (error) console.error('OPEN_THREAD_SAVE_FAILED:', error.message) }, () => {}),
  ])
}

export async function latestOpenThread(telegramId: string | number, now = Date.now()): Promise<(OpenThread & { rowId: any }) | null> {
  const since = new Date(now - THREAD_TTL_MS).toISOString()
  const { data } = await supabaseAdmin.from('agent_activity').select('id,metadata_json').eq('telegram_id', String(telegramId)).eq('event_type', OPEN_THREAD_EVENT).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  const row: any = data?.[0]
  if (!row?.metadata_json?.open) return null
  return { ...(row.metadata_json as OpenThread), rowId: row.id }
}
async function closeThread(rowId: any, resolution: string) {
  await supabaseAdmin.from('agent_activity').update({ metadata_json: { open: false, resolution } }).eq('id', rowId).then(() => {}, () => {})
}

// ── what a short reply means, against a thread ───────────────────────────────────
export type ThreadIntent = 'paid' | 'check' | 'track' | 'open' | 'ignore' | 'later' | 'what' | 'thanks'
const RE: Record<ThreadIntent, RegExp> = {
  paid: /\b(?:it(?:'s| was| is|s)?\s*(?:already\s+)?paid|already\s+paid|i\s+(?:have\s+)?paid(?:\s+(?:it|that|this))?|paid\s+(?:it|that|this|already)|payment\s+(?:is\s+)?done|(?:it'?s|its)\s+(?:done|settled|cleared|sorted)|settled|cleared)\b/i,
  check: /\b(?:check|look|read|see)\b.{0,20}\b(?:again|mail|email|inbox|once more)\b|\brecheck\b|\bany\s+update\b|\bcheck\s+again\b/i,
  track: /\btrack(?:ing)?\b.{0,12}\b(?:order|it|that|this|parcel|delivery)\b|\bwhere(?:'s| is)\s+(?:the|my)\s+(?:order|parcel)\b/i,
  open: /\b(?:open|show|send)\b.{0,10}\b(?:it|that|this|mail|email|link|message)\b|\bgmail\s+link\b|\blink\b/i,
  ignore: /\b(?:ignore|skip|not\s+important|mute\s+(?:this|it)|stop\s+(?:alerting|flagging|telling)\s+(?:me\s+)?(?:about\s+)?(?:this|it)|leave\s+it|forget\s+it|never\s*mind)\b/i,
  // Anchored: "remind me at 6pm" / "later" / "tomorrow" about the thread; "remind me to call Divya at 6pm" is its own reminder.
  later: /^\s*(?:(?:please\s+)?remind\s+me\s+(?:about\s+(?:it|this|that)\s+)?)?(?:later|again|tomorrow(?:\s+morning)?|tonight|this\s+evening|in\s+\d+\s*(?:min|minutes|hours?|hrs?)|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[.!]*\s*$/i,
  what: /^\s*(?:what(?:'s| is| was)?\s+(?:this|that|it)(?:\s+about)?|which\s+(?:payment|order|email|one)|huh|\?+)\s*\??\s*$/i,
  thanks: /^\s*(?:thanks|thank you|ok(?:ay)?|got it|noted|fine|cool|great|👍|🙏)\s*[.!]*\s*$/i,
}
const COMMAND_NOT_REPLY = new RegExp([
  // send/write/draft/forward/reply … (an) email|mail|message|note|whatsapp|text … to|for <someone>
  String.raw`\b(?:send|write|draft|compose|forward|reply|shoot|ping|mail|email|message|text|whatsapp)\b[^.?!]{0,40}\b(?:to|for)\s+(?!me\b|myself\b)(?:my\s+|the\s+)?[a-z@][\w.@'-]*`,
  // send|write|draft an email / a message / a note (no pronoun object)
  String.raw`\b(?:send|write|draft|compose)\s+(?:an?|the|my)\s+(?:email|mail|message|msg|note|reply|whatsapp|text)\b`,
  // email|message|text <Name> …  ("email Divya the summary", "message Nithin")
  String.raw`^\s*(?:please\s+)?(?:email|message|text|whatsapp|ping)\s+(?!me\b|it\b|this\b|that\b|them\b)[a-z]`,
  // mail/email/messages from|with|about <someone/something> ("check mail from Nithin", "any email from Divya")
  String.raw`\b(?:mail|email|emails|message|messages)\s+(?:from|with|about|regarding)\s+[a-z@]`,
].join('|'), 'i')

/** The intents in a reply, in the order they appear ("check the mail again and track the order" → check, track). Pure. */
export function threadIntents(text: string): ThreadIntent[] {
  const t = String(text || '').trim()
  if (!t || t.length > 160) return []
  // A new instruction is never a thread reply: composing or forwarding something to someone ("send an email to Divya
  // about the invoice", "message Nithin the link", "forward this to Divya"), or reading mail from/for a named person
  // ("check mail from Nithin"). These go to the brain even while an alert thread is open.
  if (COMMAND_NOT_REPLY.test(t)) return []
  if (RE.what.test(t)) return ['what']
  if (RE.thanks.test(t)) return ['thanks']
  const hits = (Object.keys(RE) as ThreadIntent[]).filter(k => k !== 'what' && k !== 'thanks' && RE[k].test(t)).map(k => ({ k, i: t.search(RE[k]) })).sort((a, b) => a.i - b.i).map(x => x.k)
  // "paid" wins over "later" when both appear ("it was paid later"); "ignore" is exclusive.
  if (hits.includes('ignore')) return ['ignore']
  return hits.filter((k, i, a) => a.indexOf(k) === i && !(k === 'later' && a.includes('paid')))
}

const minutesFromLater = (t: string, now: number, tz: string): number | null => {
  const m = t.match(/in\s+(\d+)\s*(min|minutes|hours?|hrs?)/i)
  if (m) return Number(m[1]) * (/^min/i.test(m[2]) ? 1 : 60)
  const at = t.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  const nowIST = new Date(now + (tz === 'Asia/Kolkata' ? 330 : 0) * 60_000)
  const curMin = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes()
  if (at) { let h = Number(at[1]); const mm = Number(at[2] || 0); if (at[3]) { if (/pm/i.test(at[3]) && h < 12) h += 12; if (/am/i.test(at[3]) && h === 12) h = 0 } else if (h <= 7) h += 12; const target = h * 60 + mm; return target > curMin ? target - curMin : target + 1440 - curMin }
  if (/tomorrow/i.test(t)) return 1440 - curMin + 9 * 60
  if (/tonight|this evening/i.test(t)) return Math.max(30, 20 * 60 - curMin)
  if (/later|again/i.test(t)) return 180
  return null
}

const short = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "open it": the email itself in WhatsApp, a line to paste into the Gmail app's search, and the computer link last. Pure. */
export function openReply(th: OpenThread, tz = 'Asia/Kolkata'): string {
  const d = th.data || {}
  const subject = short(String(d.subject || ''))
  const from = d.sender ? `${d.sender}${d.senderEmail ? ` <${d.senderEmail}>` : ''}` : d.senderEmail || ''
  const when = d.receivedAt ? new Date(d.receivedAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''
  const lines: string[] = []
  if (from) lines.push(`*From:* ${from}`)
  if (subject) lines.push(`*Subject:* ${subject}`)
  if (when) lines.push(`*Received:* ${when}`)
  if (d.snippet) lines.push('', `"${short(String(d.snippet))}${String(d.snippet).length >= 300 ? '…' : ''}"`)
  // Gmail search treats ':' and quotes as operators, so only plain words go in ("1:1" and "?" are dropped).
  const words = subject.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(w => w.length > 2).slice(0, 6).join(' ')
  const search = [d.senderEmail ? `from:${d.senderEmail}` : '', words ? `subject:(${words})` : ''].filter(Boolean).join(' ')
  if (search) lines.push('', 'To open it in the Gmail app, paste this into its search bar:', search)
  if (d.threadId && d.gmailEmail && /^[a-f0-9]{6,64}$/i.test(d.threadId)) lines.push('', `On a computer: https://mail.google.com/mail/u/?authuser=${encodeURIComponent(d.gmailEmail)}#all/${d.threadId}`)
  return lines.length ? lines.join('\n') : `I don't have the details for that one; search your mail for "${short(String(d.subject || about(th))).slice(0, 60)}".`
}
const about = (th: OpenThread) => th.data.merchant || th.data.sender || th.data.subject || 'this'

/** A short reply against the open thread → the reply, or null when there is no thread or the text isn't about it. */
export type ThreadDeps = { searchMail?: (actor: AgentActor, query: string, limit: number) => Promise<any[]>; readOrders?: (actor: AgentActor) => Promise<any[]> }
export async function tryThreadReply(actor: AgentActor, text: string, now = Date.now(), deps: ThreadDeps = {}): Promise<string | null> {
  const searchMail = deps.searchMail || (async (a: AgentActor, q: string, n: number) => (await import('./google-workspace-read')).searchWorkspaceEmailsByQuery(a, q, n))
  const readOrders = deps.readOrders || (async (a: AgentActor) => (await import('./order-tracking')).readOrders(a))
  const intents = threadIntents(text)
  if (!intents.length) return null
  const th = await latestOpenThread(actor.legacyTelegramId, now)
  if (!th) return null
  const tz = actor.timezone || 'Asia/Kolkata'
  const parts: string[] = []
  console.log('THREAD_REPLY:', JSON.stringify({ kind: th.kind, intents, merchant: th.data.merchant || null }))
  for (const intent of intents) {
    if (intent === 'what') { parts.push(`That was this, at ${new Date(th.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })}:\n${th.message}`); continue }
    if (intent === 'thanks') { await closeThread(th.rowId, 'acknowledged'); return null }
    if (intent === 'ignore') { await closeThread(th.rowId, 'ignored'); parts.push(`Okay, dropping it. I won't mention ${about(th)} again.`); continue }
    if (intent === 'paid') {
      await closeThread(th.rowId, 'paid')
      let receipt = ''
      if (th.data.merchant || th.data.senderEmail) {
        try {
          const who = th.data.merchant ? `"${th.data.merchant.split(/\s+/).slice(0, 3).join(' ')}"` : th.data.senderEmail
          const mails: any[] = await searchMail(actor, `${who} (receipt OR successful OR confirmed OR "payment received" OR invoice) newer_than:3d -in:spam -in:trash`, 5)
          const ok = mails.find(m => /success|received|confirmed|receipt|thank you for your (?:payment|order)|paid/i.test(`${m.subject} ${m.snippet || ''}`) && !/fail|unsuccessful|declined|reminder/i.test(String(m.subject)))
          receipt = ok ? ` I can see it: "${short(String(ok.subject)).slice(0, 80)}".` : ` I don't see a success receipt from ${about(th)} in your mail yet; if it was paid outside their site, that's expected.`
        } catch { receipt = '' }
      }
      parts.push(`Noted: ${about(th)}${th.data.amount ? ` (${th.data.amount})` : ''} is paid.${receipt} I won't flag this one again.`)
      continue
    }
    if (intent === 'check') {
      try {
        const q = th.data.senderEmail ? `from:${th.data.senderEmail} newer_than:3d` : th.data.subject ? `subject:"${short(th.data.subject).slice(0, 60)}" newer_than:3d` : null
        if (!q) { parts.push("I don't have enough of that email to look it up again."); continue }
        const mails: any[] = await searchMail(actor, q, 5)
        if (!mails.length) { parts.push(`Nothing newer from ${about(th)} in your mail.`); continue }
        const newest = mails[0]
        const newer = th.data.emailId ? mails.filter(m => String(m.id) !== String(th.data.emailId)) : mails.slice(1)
        const status = /success|received|confirmed|receipt|paid/i.test(`${newest.subject} ${newest.snippet || ''}`) && !/fail|unsuccessful|declined/i.test(String(newest.subject)) ? 'it reads as a success' : /fail|unsuccessful|declined/i.test(String(newest.subject)) ? 'it still reads as a failure' : 'it is neither a failure nor a receipt'
        parts.push(newer.length ? `Checked again: the latest from ${about(th)} is "${short(String(newest.subject)).slice(0, 80)}" (${newest.date || 'recent'}); ${status}.` : `Checked again: nothing new from ${about(th)} since that email.`)
      } catch { parts.push("I couldn't reach your mail just now.") }
      continue
    }
    if (intent === 'track') {
      try {
        const ot = await import('./order-tracking')
        const orders = await readOrders(actor)
        const key = (th.data.merchant || th.data.orderShop || th.data.sender || '').toLowerCase().split(/\s+/)[0]
        const mine = key ? orders.filter(o => `${o.shop} ${o.label}`.toLowerCase().includes(key)) : []
        parts.push(mine.length ? ot.formatOrders(mine, now) : orders.length ? `No order from ${about(th)} in your shop emails. Your other orders:\n${ot.formatOrders(orders.slice(0, 3), now)}` : `No order emails from ${about(th)} yet. If it was paid, the shop usually sends the order confirmation within a few minutes.`)
      } catch { parts.push("I couldn't read your order emails just now.") }
      continue
    }
    if (intent === 'open') {
      // 8 Nov: a Gmail web link opens the right email only on a computer; on a phone it lands on the inbox and the Gmail
      // app does not take web links to one email. So the email comes to WhatsApp, with a search line for the app.
      parts.push(openReply(th, tz))
      continue
    }
    if (intent === 'later') {
      const mins = minutesFromLater(text, now, tz)
      if (mins === null) { parts.push('When should I remind you? Say "in 2 hours", "at 6pm" or "tomorrow".'); continue }
      const at = new Date(now + mins * 60_000)
      const message = `${th.kind === 'mail_alert' ? 'Email' : 'Earlier'}: ${short(th.message).slice(0, 140)}`
      const { error } = await supabaseAdmin.from('reminders').insert({ telegram_id: actor.legacyTelegramId, chat_id: actor.legacyTelegramId, message, remind_at: at.toISOString(), sent: false, timezone: tz, whatsapp_to: actor.whatsappId || null })
      parts.push(error ? "I couldn't set that reminder just now." : `I'll bring it back ${at.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz })}.`)
      await closeThread(th.rowId, 'deferred')
    }
  }
  return parts.length ? parts.join('\n\n') : null
}
