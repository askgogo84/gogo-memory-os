// Meta Cloud API inbound for the consumer AskGogo number: signature, handshake, and translation of each message into
// the exact field names the existing WhatsApp pipeline already reads (the ones Twilio posts). Pure; no I/O.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isMetaMessageId } from './provider'

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). Fails closed on any missing piece. */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string | undefined): boolean {
  const secret = String(appSecret || '').trim(), given = String(header || '').trim()
  if (!secret || !/^sha256=[0-9a-f]{64}$/i.test(given)) return false
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`)
  const actual = Buffer.from(given.toLowerCase())
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Webhook handshake (GET). Returns the challenge to echo, or null. */
export function metaHandshakeChallenge(params: URLSearchParams, verifyToken: string | undefined): string | null {
  const token = String(verifyToken || '').trim(), given = params.get('hub.verify_token') || ''
  if (!token || params.get('hub.mode') !== 'subscribe') return null
  const a = Buffer.from(token), b = Buffer.from(given)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return params.get('hub.challenge')
}

export type MetaInboundMessage = {
  id: string; from: string; to: string; profileName: string
  kind: 'text' | 'button' | 'list' | 'media'
  text: string; buttonPayload: string; buttonText: string; listId: string; repliedToId: string; mediaType: string
}
export type MetaStatus = { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; errorCode: string }
export type MetaWebhook = { messages: MetaInboundMessage[]; statuses: MetaStatus[]; ignored: number }

const REMINDER_PAYLOADS = new Set(['done', 'snooze_10', 'move_8pm'])
const digitsOf = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Messages and delivery statuses addressed to OUR phone number id; everything else is counted and ignored. */
export function parseMetaWebhook(body: any, phoneNumberId: string | undefined): MetaWebhook {
  const out: MetaWebhook = { messages: [], statuses: [], ignored: 0 }
  const ours = String(phoneNumberId || '').trim()
  if (!ours || body?.object !== 'whatsapp_business_account') return out
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
    const value = change?.value
    if (change?.field !== 'messages' || String(value?.metadata?.phone_number_id || '') !== ours) { out.ignored++; continue }
    const to = digitsOf(value?.metadata?.display_phone_number)
    const names = new Map<string, string>()
    for (const c of Array.isArray(value?.contacts) ? value.contacts : []) names.set(digitsOf(c?.wa_id), String(c?.profile?.name || '').slice(0, 120))
    for (const m of Array.isArray(value?.messages) ? value.messages : []) {
      const id = String(m?.id || ''), from = digitsOf(m?.from)
      if (!isMetaMessageId(id) || from.length < 8 || from.length > 15) { out.ignored++; continue }
      const baseMsg = { id, from, to, profileName: names.get(from) || '', text: '', buttonPayload: '', buttonText: '', listId: '', mediaType: '',
        repliedToId: isMetaMessageId(m?.context?.id) ? String(m.context.id) : '' }
      if (m.type === 'text' && typeof m.text?.body === 'string') out.messages.push({ ...baseMsg, kind: 'text', text: m.text.body.slice(0, 4096) })
      else if (m.type === 'interactive' && m.interactive?.type === 'button_reply') {
        const title = String(m.interactive.button_reply?.title || '').slice(0, 60), bid = String(m.interactive.button_reply?.id || '').slice(0, 256)
        // Only the reminder taps travel as a payload; any other button behaves like the person typed its title.
        out.messages.push({ ...baseMsg, kind: 'button', text: title, buttonText: title, buttonPayload: REMINDER_PAYLOADS.has(bid) ? bid : '' })
      } else if (m.type === 'button') {
        const title = String(m.button?.text || '').slice(0, 60), payload = String(m.button?.payload || '').slice(0, 256)
        out.messages.push({ ...baseMsg, kind: 'button', text: title, buttonText: title, buttonPayload: REMINDER_PAYLOADS.has(payload) ? payload : '' })
      } else if (m.type === 'interactive' && m.interactive?.type === 'list_reply') {
        const title = String(m.interactive.list_reply?.title || '').slice(0, 60)
        out.messages.push({ ...baseMsg, kind: 'list', text: title, listId: String(m.interactive.list_reply?.id || '').slice(0, 200) })
      } else if (['image', 'audio', 'document', 'video', 'sticker'].includes(String(m.type))) {
        out.messages.push({ ...baseMsg, kind: 'media', mediaType: String(m.type) })
      } else out.ignored++
    }
    for (const s of Array.isArray(value?.statuses) ? value.statuses : []) {
      const id = String(s?.id || ''), status = String(s?.status || '')
      if (!isMetaMessageId(id) || !['sent', 'delivered', 'read', 'failed'].includes(status)) { out.ignored++; continue }
      out.statuses.push({ id, status: status as MetaStatus['status'], errorCode: s?.errors?.[0]?.code != null ? String(s.errors[0].code).slice(0, 20) : '' })
    }
  }
  return out
}

/** The form fields the existing pipeline reads, for one text, button or list message. */
export function pipelineParams(m: MetaInboundMessage): Record<string, string> {
  if (m.kind === 'media') throw new Error('media_not_bridged')
  const params: Record<string, string> = {
    From: `whatsapp:+${m.from}`, To: `whatsapp:+${m.to}`, WaId: m.from, MessageSid: m.id, SmsMessageSid: m.id,
    ProfileName: m.profileName || 'Friend', NumMedia: '0', Body: m.text,
  }
  if (m.buttonText) params.ButtonText = m.buttonText
  if (m.buttonPayload) params.ButtonPayload = m.buttonPayload
  if (m.kind === 'list') { params.ListId = m.listId; params.ListTitle = m.text }
  if (m.repliedToId) params.OriginalRepliedMessageSid = m.repliedToId
  return params
}
