// Forwarded mail: stored per person, scored, and only urgent mail is pushed to WhatsApp right away.
// Everything else waits for "emails that need me" or the morning brief. Kept 30 days.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { deliverNotification } from '@/lib/services/notification-delivery'
import { aliasFromAddress, ownerOfAlias } from './aliases'
import { parseMail, previewText, gmailForwardingConfirmation, type ParsedMail } from './mime'
import { scoreEmail, formatAttentionCard, type AttentionEmail } from './attention'
import { loadRules } from './attention-store'

export const PUSH_SCORE = 0.8
export const MAX_PUSHES_PER_DAY = 6

function clean(v: unknown, max = 500) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }

export function threadKeyOf(mail: Pick<ParsedMail, 'messageId' | 'inReplyTo' | 'references'>) {
  const first = mail.references.match(/<[^>]+>/)?.[0] || mail.inReplyTo.match(/<[^>]+>/)?.[0] || mail.messageId
  return first ? createHash('sha256').update(first.toLowerCase()).digest('hex').slice(0, 24) : null
}

export function confirmationText(code: string, forwarder: string | null) {
  return `📬 Gmail sent your forwarding confirmation code${forwarder ? ` for ${forwarder}` : ''}:\n\n*${code}*\n\nPaste it in Gmail › Settings › Forwarding and POP/IMAP, then choose "Forward a copy of incoming mail".\nhttps://mail.google.com/mail/u/0/#settings/fwdandpop`
}

export const FORWARDING_ON_TEXT = `📬 Forwarding is on. Your first forwarded email arrived.\n\nFrom now on I'll only tell you about mail that needs you. Ask "emails that need me" any time.`

function localHour(timezone: string, now = Date.now()) {
  let tz = timezone || 'Asia/Kolkata'
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }) } catch { tz = 'Asia/Kolkata' }
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(now))) % 24
}

export function isQuietHour(timezone: string, now = Date.now()) {
  const h = localHour(timezone, now)
  return h >= 22 || h < 7
}

async function notify(telegramId: number, key: string, text: string) {
  const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', telegramId).maybeSingle()
  if (!user?.whatsapp_id) return false
  const result = await deliverNotification({
    key, source: 'watch_alert', owner: telegramId, channel: 'whatsapp', due: new Date().toISOString(), deadline: Date.now() + 15_000,
    prepare: async () => {}, ready: async () => true,
    send: async token => String((await sendWhatsApp(String(user.whatsapp_id), text, null, token))?.sid || ''),
  }).catch((err: any) => { console.error('INBOUND_NOTIFY_FAILED:', err?.message || err); return 'failed' })
  // The chat history carries the card so "draft 1" / "not important 1" bind to it on WhatsApp and the dashboard.
  if (result !== 'skipped' && result !== 'failed') await supabaseAdmin.from('conversations').insert({ telegram_id: telegramId, role: 'assistant', content: text }).then(() => {}, () => {})
  return result !== 'failed'
}

export type InboundResult = { status: 'stored' | 'duplicate' | 'unknown_alias' | 'confirmation' | 'ignored'; pushed?: boolean; telegramId?: number }

export async function processInboundEmail(input: { to: string; from?: string; raw: string; now?: number }): Promise<InboundResult> {
  const now = input.now ?? Date.now()
  const mail = parseMail(input.raw)
  const alias = aliasFromAddress(input.to) || aliasFromAddress(mail.to)
  if (!alias) return { status: 'unknown_alias' }
  const owner = await ownerOfAlias(alias)
  if (!owner) return { status: 'unknown_alias' }
  const telegramId = owner.telegramId

  const confirm = gmailForwardingConfirmation(mail)
  if (confirm) {
    await supabaseAdmin.from('inbound_emails').upsert({
      telegram_id: telegramId, alias, message_id: mail.messageId || `confirm-${confirm.code}`, from_addr: clean(mail.from, 300), to_addr: clean(mail.to, 300),
      subject: clean(mail.subject, 300), snippet: `Gmail forwarding confirmation code ${confirm.code}`, category: 'forwarding_confirmation', received_at: new Date(now).toISOString(),
    }, { onConflict: 'telegram_id,message_id', ignoreDuplicates: true })
    await notify(telegramId, `email-forward-confirm/${telegramId}/${confirm.code}`, confirmationText(confirm.code, confirm.forwarder))
    return { status: 'confirmation', telegramId }
  }

  const messageId = mail.messageId || `sha-${createHash('sha256').update(input.raw.slice(0, 20000)).digest('hex').slice(0, 32)}`
  const email: AttentionEmail = {
    id: messageId, threadId: threadKeyOf(mail), messageId, from: mail.from, to: mail.to, subject: mail.subject || '(no subject)',
    snippet: previewText(mail.text, 500), internalDate: now, listId: mail.listId, listUnsubscribe: mail.listUnsubscribe,
    autoSubmitted: mail.autoSubmitted, precedence: mail.precedence, source: 'forwarded',
  }
  const rules = await loadRules(telegramId)
  const scored = scoreEmail(email, { rules, now })
  const { data: inserted, error } = await supabaseAdmin.from('inbound_emails').upsert({
    telegram_id: telegramId, alias, message_id: messageId, thread_key: email.threadId, from_addr: clean(mail.from, 300), to_addr: clean(mail.to, 300),
    subject: clean(mail.subject, 300), snippet: email.snippet, body_text: mail.text.slice(0, 20000), list_id: clean(mail.listId, 300) || null,
    list_unsubscribe: clean(mail.listUnsubscribe, 500) || null, auto_submitted: clean(mail.autoSubmitted, 80) || null,
    received_at: new Date(now).toISOString(), category: scored.category, score: scored.score, picked: scored.picked,
  }, { onConflict: 'telegram_id,message_id', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`inbound_store_failed:${error.message}`)
  if (!inserted?.length) return { status: 'duplicate', telegramId }

  const at = new Date(now).toISOString()
  await supabaseAdmin.from('email_aliases').update({ last_received_at: at, ...(owner.confirmedAt ? {} : { forwarding_confirmed_at: at }) }).eq('alias', alias)
  if (!owner.confirmedAt) await notify(telegramId, `email-forward-on/${telegramId}`, FORWARDING_ON_TEXT)
  // Opportunistic 30-day retention for this person.
  await supabaseAdmin.from('inbound_emails').delete().eq('telegram_id', telegramId).lt('received_at', new Date(now - 30 * 86400_000).toISOString()).then(() => {}, () => {})

  if (scored.score < PUSH_SCORE) return { status: 'stored', pushed: false, telegramId }
  const { data: user } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', telegramId).maybeSingle()
  const timezone = String(user?.timezone || 'Asia/Kolkata')
  if (isQuietHour(timezone, now) && scored.category !== 'service_risk' && scored.category !== 'security') return { status: 'stored', pushed: false, telegramId }
  const dayStart = new Date(now - 24 * 3600_000).toISOString()
  const { count } = await supabaseAdmin.from('inbound_emails').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId).gte('notified_at', dayStart)
  if ((count || 0) >= MAX_PUSHES_PER_DAY) return { status: 'stored', pushed: false, telegramId }

  const text = formatAttentionCard({ picked: [scored], skipped: [], checked: 1 }, { timezone, now }).replace(/^📬 1 email needs you/, '📬 1 email needs you now')
  await supabaseAdmin.from('email_attention_events').insert({ telegram_id: telegramId, kind: 'shown', payload: { sources: ['forwarded'], checked: 1, items: [{
    index: 1, id: messageId, threadId: email.threadId, messageId, from: mail.from, subject: clean(mail.subject, 200), snippet: email.snippet,
    category: scored.category, senderEmail: scored.senderEmail, senderName: scored.senderName, why: scored.why, ask: scored.ask, source: 'forwarded', score: scored.score,
  }] } })
  const pushed = await notify(telegramId, `email-urgent/${telegramId}/${messageId.slice(0, 80)}`, text)
  if (pushed) await supabaseAdmin.from('inbound_emails').update({ notified_at: at }).eq('telegram_id', telegramId).eq('message_id', messageId)
  return { status: 'stored', pushed, telegramId }
}
