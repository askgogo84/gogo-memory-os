// Phase 3 — the WhatsApp channel for the pilot: Meta Cloud API on the test number (not Twilio, not Tipplr's live
// number). Text + up to three reply buttons. Env: META_WA_TOKEN, META_WA_PHONE_ID, META_WA_APP_SECRET (webhook
// signature), META_WA_VERIFY_TOKEN (webhook handshake). With no env set, sends are recorded, not made.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MerchantMessage } from './merchant-messages'

export type Sender = (to: string, message: MerchantMessage) => Promise<{ ok: boolean; status: number; id?: string | null; error?: string }>
const GRAPH = 'https://graph.facebook.com/v21.0'

/** The Cloud API payload: interactive buttons when there are buttons, plain text otherwise. Pure. */
export function cloudPayload(to: string, m: MerchantMessage) {
  const toDigits = to.replace(/\D/g, '')
  if (!m.buttons.length) return { messaging_product: 'whatsapp', to: toDigits, type: 'text', text: { preview_url: false, body: m.text } }
  return { messaging_product: 'whatsapp', to: toDigits, type: 'interactive', interactive: { type: 'button', body: { text: m.text.slice(0, 1024) }, action: { buttons: m.buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } } }
}

export function metaConfigured() { return Boolean(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID) }

/** Real sender (Cloud API). Never throws; a failure is a result the caller records. */
export const sendViaMeta: Sender = async (to, message) => {
  if (!metaConfigured()) return { ok: false, status: 0, error: 'meta_not_configured' }
  try {
    const r = await fetch(`${GRAPH}/${process.env.META_WA_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.META_WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cloudPayload(to, message)) })
    const body: any = await r.json().catch(() => ({}))
    console.log('TIPPLR_WA_SENT:', JSON.stringify({ to: to.slice(-4), status: r.status, id: body?.messages?.[0]?.id || null, buttons: message.buttons.length }))
    return { ok: r.ok, status: r.status, id: body?.messages?.[0]?.id || null, error: r.ok ? undefined : String(body?.error?.message || r.status).slice(0, 120) }
  } catch (err: any) { return { ok: false, status: 0, error: String(err?.message || err).slice(0, 120) } }
}

/** Test/preview sender: keeps what would have been sent. */
export function recordingSender() {
  const sent: { to: string; message: MerchantMessage }[] = []
  const send: Sender = async (to, message) => { sent.push({ to, message }); return { ok: true, status: 200, id: `rec_${sent.length}` } }
  return { send, sent }
}

/** Webhook handshake (GET): Meta sends hub.mode, hub.verify_token, hub.challenge. Pure. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null
  return params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === verifyToken ? params.get('hub.challenge') : null
}

/** Webhook signature (POST): X-Hub-Signature-256 = sha256 HMAC of the raw body with the app secret. Pure. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
  const a = Buffer.from(expected), b = Buffer.from(header)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type Inbound = { from: string; text: string; kind: 'button' | 'text'; messageId: string }
/** The merchant's taps and texts out of a webhook body. Statuses and anything else are ignored. Pure. */
export function parseInbound(body: any): Inbound[] {
  const out: Inbound[] = []
  for (const entry of body?.entry || []) for (const ch of entry?.changes || []) for (const m of ch?.value?.messages || []) {
    const from = String(m?.from || '').replace(/\D/g, '')
    if (!from) continue
    if (m.type === 'interactive' && m.interactive?.type === 'button_reply') out.push({ from, text: String(m.interactive.button_reply.id || ''), kind: 'button', messageId: String(m.id || '') })
    else if (m.type === 'button' && m.button?.payload) out.push({ from, text: String(m.button.payload), kind: 'button', messageId: String(m.id || '') })
    else if (m.type === 'text' && m.text?.body) out.push({ from, text: String(m.text.body).slice(0, 500), kind: 'text', messageId: String(m.id || '') })
  }
  return out
}

/** Meta redelivers webhooks it thinks failed. Each message id is handled once: the first caller claims it, later ones get false.
 *  The claim lives in agent_activity (event tipplr_wa_inbound); a store error is treated as "not claimed" so a real message is never dropped. */
export async function claimInbound(db: { from: (t: string) => any }, messageId: string, from: string): Promise<boolean> {
  if (!messageId) return true
  try {
    const { data } = await db.from('agent_activity').select('id').eq('telegram_id', 'tipplr-wa').eq('event_type', 'tipplr_wa_inbound').eq('message', messageId).limit(1)
    if (data?.length) { console.log('TIPPLR_WA_DUPLICATE:', JSON.stringify({ messageId, from: from.slice(-4) })); return false }
    const { error } = await db.from('agent_activity').insert({ telegram_id: 'tipplr-wa', event_type: 'tipplr_wa_inbound', message: messageId, metadata_json: { from: from.slice(-4), at: new Date().toISOString() } })
    if (error) console.error('TIPPLR_WA_CLAIM_FAILED:', String(error.message || '').slice(0, 120))
    return true
  } catch { return true }
}
