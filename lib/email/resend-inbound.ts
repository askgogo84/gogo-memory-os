// Resend inbound (in.askgogo.in MX → Resend → email.received webhook). Chosen 23 Oct over moving askgogo.in DNS to
// Cloudflare: one MX record at GoDaddy, nothing else changes. The webhook carries metadata only, so the full message
// is fetched from Resend's Receiving API (raw RFC 822 when available) and handed to the same inbound pipeline.
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Svix signature check used by Resend webhooks: HMAC-SHA256 over "id.timestamp.body" with the whsec_ key. */
export function verifyResendWebhook(p: { secret: string; id: string; timestamp: string; signature: string; body: string; now?: number }) {
  if (!p.secret || !p.id || !p.timestamp || !p.signature) return false
  const ts = Number(p.timestamp)
  if (!Number.isFinite(ts) || Math.abs((p.now ?? Date.now()) / 1000 - ts) > 300) return false
  const key = Buffer.from(p.secret.replace(/^whsec_/, ''), 'base64')
  const expected = Buffer.from(createHmac('sha256', key).update(`${p.id}.${p.timestamp}.${p.body}`).digest('base64'))
  return p.signature.split(' ').some(part => {
    const sig = Buffer.from(part.replace(/^v1,/, ''))
    return sig.length === expected.length && timingSafeEqual(sig, expected)
  })
}

type ReceivedEmail = {
  id: string; to: string[]; from: string; subject: string; received_for?: string[]; html: string | null; text: string | null
  headers: Record<string, string> | null; message_id: string; raw?: { download_url: string } | null; created_at?: string
}

/** Rebuilds a plain RFC 822 message when the raw source is not available. */
export function rawFromParsed(e: ReceivedEmail) {
  const h: Record<string, string> = { ...(e.headers || {}) }
  const get = (k: string) => Object.entries(h).find(([key]) => key.toLowerCase() === k)?.[1]
  const lines = [
    `From: ${get('from') || e.from}`, `To: ${get('to') || (e.to || []).join(', ')}`, `Subject: ${get('subject') || e.subject || ''}`,
    `Message-ID: ${get('message-id') || e.message_id || ''}`, `Date: ${get('date') || e.created_at || ''}`,
  ]
  for (const k of ['list-id', 'list-unsubscribe', 'auto-submitted', 'precedence', 'in-reply-to', 'references']) { const v = get(k); if (v) lines.push(`${k}: ${v}`) }
  const body = e.text || (e.html ? e.html : '')
  lines.push(`Content-Type: ${e.text ? 'text/plain' : 'text/html'}; charset=utf-8`, '', body)
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('latin1')
}

export async function fetchReceivedEmail(emailId: string, fetchImpl: typeof fetch = fetch) {
  const key = (process.env.RESEND_API_KEY || '').trim()
  if (!key) throw new Error('resend_key_missing')
  const res = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`resend_receiving_${res.status}`)
  const email = await res.json() as ReceivedEmail
  let raw = ''
  if (email.raw?.download_url && /^https:\/\//.test(email.raw.download_url)) {
    const r = await fetchImpl(email.raw.download_url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (r?.ok) raw = Buffer.from(await r.arrayBuffer()).toString('latin1')
  }
  return { email, raw: raw || rawFromParsed(email) }
}
