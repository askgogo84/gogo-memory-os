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

export function confirmationText(code: string | null, forwarder: string | null, link: string | null = null) {
  if (code) return `📬 Gmail sent your forwarding confirmation code${forwarder ? ` for ${forwarder}` : ''}:\n\n*${code}*\n\nPaste it in Gmail › Settings › Forwarding and POP/IMAP, then choose "Forward a copy of incoming mail".\nhttps://mail.google.com/mail/u/0/#settings/fwdandpop`
  return `📬 Gmail needs you to confirm forwarding${forwarder ? ` from ${forwarder}` : ''}. Open this link and tap Confirm:\n\n${link}\n\nThen in Gmail › Settings › Forwarding and POP/IMAP, choose "Forward a copy of incoming mail" and save.`
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
  // Only a recorded provider acceptance can seed a visible conversation card or the
  // inbound message's notified_at receipt. "skipped", "deferred", "suppressed",
  // "persistence_failed" and "outcome_unknown" are NOT evidence of a send.
  // Acceptance still is not verified delivery; the delivery ledger reconciles it.
  // Never retry an unknown outcome from here.
  if (result === 'provider_accepted') await supabaseAdmin.from('conversations').insert({ telegram_id: telegramId, role: 'assistant', content: text }).then(() => {}, () => {})
  return result === 'provider_accepted'
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
      telegram_id: telegramId, alias, message_id: mail.messageId || `confirm-${confirm.code || createHash('sha256').update(String(confirm.link)).digest('hex').slice(0, 16)}`, from_addr: clean(mail.from, 300), to_addr: clean(mail.to, 300),
      subject: clean(mail.subject, 300), snippet: confirm.code ? `Gmail forwarding confirmation code ${confirm.code}` : 'Gmail forwarding confirmation link', body_text: confirm.link || '', category: 'forwarding_confirmation', received_at: new Date(now).toISOString(),
    }, { onConflict: 'telegram_id,message_id', ignoreDuplicates: true })
    // red #1119: the only evidence that records which mailbox forwards here is Gmail's own confirmation email, with
    // its numeric confirmation code, delivered to this alias (envelope and visible To). Header-based, not
    // cryptographic; a later forwarded mail can turn forwarding on only against this recorded address.
    const verifiedForwarder = String(confirm.forwarder || '').trim().toLowerCase()
    if (confirm.code && aliasFromAddress(input.to) === alias && aliasFromAddress(mail.to) === alias
      && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(verifiedForwarder) && !aliasFromAddress(verifiedForwarder)) {
      const changed = (owner as { verifiedForwarder?: string | null }).verifiedForwarder !== verifiedForwarder
      try {
        const { error: recordError } = await supabaseAdmin.from('email_aliases')
          .update({ forwarding_verified_address: verifiedForwarder, ...(changed ? { forwarding_confirmed_at: null } : {}) }).eq('alias', alias)
        // Before the migration the column is missing: forwarding then simply stays "not confirmed".
        if (recordError) console.error('EMAIL_FORWARDING_VERIFIED_ADDRESS_NOT_RECORDED:', String(recordError.message || recordError).slice(0, 160))
      } catch (err: any) {
        console.error('EMAIL_FORWARDING_VERIFIED_ADDRESS_NOT_RECORDED:', String(err?.message || err).slice(0, 160))
      }
    }
    await notify(telegramId, `email-forward-confirm/${telegramId}/${confirm.code || createHash('sha256').update(String(confirm.link)).digest('hex').slice(0, 16)}`, confirmationText(confirm.code, confirm.forwarder, confirm.link))
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
  // red #1119: X-Forwarded-To/For and the visible To are sender-controlled, so on their own they never turn forwarding
  // "on". Forwarding becomes active only when this mail was delivered to the owner's alias (envelope recipient) AND its
  // original recipient is the forwarding address recorded from Gmail's confirmation email. No recorded address (or no
  // migration yet) means forwarding stays "not confirmed".
  const verifiedForwarder = (owner as { verifiedForwarder?: string | null }).verifiedForwarder || null
  const envelopeIsAlias = aliasFromAddress(input.to) === alias
  const originalRecipients = verifiedForwarder
    ? (`${mail.headers['x-forwarded-for'] || ''} ${mail.to}`.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [])
    : []
  const firstForward = !owner.confirmedAt && Boolean(verifiedForwarder) && envelopeIsAlias
    && originalRecipients.includes(String(verifiedForwarder)) && !/@(?:google|accounts\.google)\.com\b/i.test(mail.from)
  await supabaseAdmin.from('email_aliases').update({ last_received_at: at, ...(firstForward ? { forwarding_confirmed_at: at } : {}) }).eq('alias', alias)
  if (firstForward) await notify(telegramId, `email-forward-on/${telegramId}`, FORWARDING_ON_TEXT)
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
