// Meta WhatsApp Cloud API: payload builders (pure) and the sender. Consumer AskGogo number only; the Tipplr merchant
// pilot keeps its own module and its own META_WA_* credentials. Env: GOGO_META_WA_TOKEN, GOGO_META_WA_PHONE_ID,
// optional GOGO_META_GRAPH_VERSION. The token is read at call time and never logged.
import { waDigits } from './provider'

export const META_TEXT_MAX = 4096
export const META_CAPTION_MAX = 1024
export type MetaButton = { id: string; title: string }
export type MetaListRow = { id: string; title: string; description?: string }
export type MetaSendResult = { sid: string; status: 'accepted' }
type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env

function recipient(to: unknown): string {
  const digits = waDigits(to)
  if (digits.length < 8 || digits.length > 15) throw new Error('Invalid WhatsApp phone number')
  return digits
}
const base = (to: unknown, replyToId?: string | null) => ({
  messaging_product: 'whatsapp' as const, recipient_type: 'individual' as const, to: recipient(to),
  ...(replyToId ? { context: { message_id: String(replyToId) } } : {}),
})

export function metaTextPayload(to: unknown, body: string, replyToId?: string | null) {
  const text = String(body || '').slice(0, META_TEXT_MAX)
  return { ...base(to, replyToId), type: 'text' as const, text: { preview_url: /https?:\/\//i.test(text), body: text } }
}

export type MetaMediaKind = 'image' | 'document' | 'audio' | 'video'
/** Media kind from a content type or, failing that, the URL's file extension. Unknown content goes as a document. */
export function metaMediaKind(url: string, contentType?: string | null): MetaMediaKind {
  const type = String(contentType || '').toLowerCase()
  if (/^image\/(?:jpeg|png|webp)\b/.test(type)) return 'image'
  if (/^audio\//.test(type)) return 'audio'
  if (/^video\/(?:mp4|3gpp)\b/.test(type)) return 'video'
  if (type) return 'document'
  let path = ''
  try { path = new URL(url).pathname.toLowerCase() } catch { path = '' }
  if (/\.(?:jpe?g|png|webp)$/.test(path)) return 'image'
  if (/\.(?:mp3|ogg|opus|m4a|aac|amr)$/.test(path)) return 'audio'
  if (/\.(?:mp4|3gp)$/.test(path)) return 'video'
  return 'document'
}

export function metaMediaPayload(to: unknown, mediaUrl: string, caption?: string | null, kind?: MetaMediaKind) {
  const link = String(mediaUrl || '').trim()
  if (!/^https:\/\//i.test(link)) throw new Error('Meta media must be an https link')
  const k = kind || metaMediaKind(link)
  const cap = String(caption || '').trim()
  const media: Record<string, string> = { link }
  if (cap && k !== 'audio') media.caption = cap.slice(0, META_CAPTION_MAX)
  return { ...base(to), type: k, [k]: media }
}

/** Up to three reply buttons. A tap comes back with the button id and title. */
export function metaButtonsPayload(to: unknown, body: string, buttons: MetaButton[]) {
  const list = buttons.slice(0, 3).map(b => ({ type: 'reply' as const, reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } }))
  if (!list.length) throw new Error('Meta buttons need at least one button')
  return { ...base(to), type: 'interactive' as const, interactive: { type: 'button' as const, body: { text: String(body || '').slice(0, 1024) }, action: { buttons: list } } }
}

/** A list menu of up to ten rows. */
export function metaListPayload(to: unknown, body: string, buttonLabel: string, rows: MetaListRow[]) {
  const list = rows.slice(0, 10).map(r => ({ id: String(r.id).slice(0, 200), title: String(r.title).slice(0, 24), ...(r.description ? { description: String(r.description).slice(0, 72) } : {}) }))
  if (!list.length) throw new Error('Meta list needs at least one row')
  return { ...base(to), type: 'interactive' as const, interactive: { type: 'list' as const, body: { text: String(body || '').slice(0, 1024) }, action: { button: String(buttonLabel || 'Choose').slice(0, 20), sections: [{ title: 'Options', rows: list }] } } }
}

export type MetaTemplateOptions = { language?: string; bodyParams?: string[]; quickReplyPayloads?: string[]; otpCode?: string }
/** An approved template (needed outside the 24-hour window). Names and languages come from WhatsApp Manager. */
export function metaTemplatePayload(to: unknown, name: string, options: MetaTemplateOptions = {}) {
  const tpl = String(name || '').trim()
  if (!/^[a-z0-9_]{1,512}$/.test(tpl)) throw new Error('Invalid Meta template name')
  const components: any[] = []
  if (options.bodyParams?.length) components.push({ type: 'body', parameters: options.bodyParams.map(text => ({ type: 'text', text: String(text) })) })
  ;(options.quickReplyPayloads || []).slice(0, 3).forEach((payload, index) => components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: String(payload) }] }))
  // Authentication templates carry the code in the body and again in the copy-code button.
  if (options.otpCode) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(options.otpCode) }] })
  return { ...base(to), type: 'template' as const, template: { name: tpl, language: { code: options.language || 'en' }, ...(components.length ? { components } : {}) } }
}

/** Marks the inbound message read and shows "typing" until the reply or 25 seconds, whichever is first. */
export function metaTypingPayload(inboundMessageId: string) {
  return { messaging_product: 'whatsapp' as const, status: 'read' as const, message_id: String(inboundMessageId), typing_indicator: { type: 'text' as const } }
}

export function metaGraphBase(env: Env = envOf()): string {
  const version = /^v\d{1,3}\.\d$/.test((env.GOGO_META_GRAPH_VERSION || '').trim()) ? (env.GOGO_META_GRAPH_VERSION || '').trim() : 'v21.0'
  return `https://graph.facebook.com/${version}`
}

export class MetaSendError extends Error {
  status: number; code: number | null
  constructor(message: string, status: number, code: number | null) { super(message); this.name = 'MetaSendError'; this.status = status; this.code = code }
}

type Deps = { fetchImpl?: typeof fetch; env?: Env }
/** POSTs one payload. Resolves with Meta's message id; throws MetaSendError when Meta does not accept it. */
export async function metaSend(payload: Record<string, unknown>, deps: Deps = {}): Promise<MetaSendResult> {
  const env = deps.env || envOf()
  const token = (env.GOGO_META_WA_TOKEN || '').trim(), phoneId = (env.GOGO_META_WA_PHONE_ID || '').trim()
  if (!token || !/^\d{5,20}$/.test(phoneId)) throw new MetaSendError('meta_not_configured', 0, null)
  const response = await (deps.fetchImpl || fetch)(`${metaGraphBase(env)}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
  })
  const body: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new MetaSendError(String(body?.error?.message || `meta_http_${response.status}`).slice(0, 200), response.status, Number.isInteger(body?.error?.code) ? body.error.code : null)
  // A read/typing call answers { success: true } with no message id.
  const sid = String(body?.messages?.[0]?.id || '')
  if (!sid && payload.status !== 'read') throw new MetaSendError('meta_no_message_id', response.status, null)
  return { sid, status: 'accepted' }
}
