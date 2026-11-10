// The Meta webhook's inbox (supabase/migrations/20261110190000_wa_meta_inbox.sql). The webhook stores each verified
// message and answers Meta at once; drainMetaInbox hands messages to the existing pipeline, oldest first, one at a
// time per person. Used only when GOGO_WA_META_INBOX=1. The database client and the network are injectable.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeTwilioSignature } from '@/lib/security/webhook-signature'

type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any }
type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env
export const metaInboxEnabled = (env: Env = envOf()) => env.GOGO_WA_META_INBOX === '1'

/** Where the pipeline lives: only a configured https URL with the exact pipeline path, never derived from a request. */
export function pipelineUrl(env: Env = envOf()): string | null {
  const configured = (env.TWILIO_WHATSAPP_WEBHOOK_URL || env.GOGO_WA_PIPELINE_URL || '').trim()
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/webhooks/whatsapp') return null
    return url.toString()
  } catch { return null }
}

export type ForwardResult = 'done' | 'busy' | 'retry'
/** Hands one message to the pipeline, signed with the secret its gate already requires. 'busy' is final: the
 *  pipeline has already told the person to send it again. */
export async function forwardToPipeline(params: Record<string, string>, opts: { fetchImpl?: typeof fetch; env?: Env } = {}): Promise<{ result: ForwardResult; status: number }> {
  const env = opts.env || envOf()
  const url = pipelineUrl(env), secret = env.TWILIO_AUTH_TOKEN || ''
  if (!url || !secret) return { result: 'retry', status: 0 }
  let status = 0
  try {
    const response = await (opts.fetchImpl || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': computeTwilioSignature(secret, url, params) },
      body: new URLSearchParams(params).toString(),
      redirect: 'error', // never re-send the message and its signature to a redirect target
      signal: AbortSignal.timeout(110_000),
    })
    status = response.status
    if (status === 503 && (await response.text().catch(() => '')).trim() === 'Busy') return { result: 'busy', status }
  } catch { status = 0 }
  return { result: status >= 200 && status < 300 ? 'done' : 'retry', status }
}

/** jsonb cannot hold a NUL character; one in any field would make the whole webhook batch fail and be redelivered
 *  for ever. It is removed (it carries no meaning in a chat message). */
export const storableParams = (params: Record<string, string>) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v).replace(/\u0000/g, '')]))

/** Stores verified messages in the order given (one statement; seq keeps that order). A redelivered message id is
 *  ignored. Returns false only when storing failed. */
export async function storeInbound(rows: { id: string; from: string; params: Record<string, string> }[], db: Db = supabaseAdmin as any): Promise<boolean> {
  if (!rows.length) return true
  const res = await db.from('wa_meta_inbox').upsert(rows.map(r => ({ message_id: r.id, sender: r.from, params: storableParams(r.params) })), { onConflict: 'message_id', ignoreDuplicates: true })
  if (res?.error) { console.error('WHATSAPP_META_INBOX_STORE_FAILED:', JSON.stringify({ code: String(res.error.code || '').slice(0, 12) })); return false }
  return true
}

/** Wait before the next try: 30 s, 1, 2, 4, 8, 16 min, then every 30 min, until the six-hour window ends. */
export const retryDelayMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000)

export type DrainResult = { done: number; retried: number; gaveUp: number; lost: number }
/** One round: claims at most one message per person (up to ten people) and hands them over in parallel. One round per
 *  call, because a single hand-over can take up to 110 s and the function's limit is 120 s; the minute cron and the
 *  next webhook pick up the rest. Every write is tied to this claim's lease id, so a stale worker changes nothing. */
export async function drainMetaInbox(opts: { db?: Db; forward?: typeof forwardToPipeline; notify?: (sender: string) => Promise<void> } = {}): Promise<DrainResult> {
  const db = opts.db || (supabaseAdmin as any), forward = opts.forward || forwardToPipeline
  const out: DrainResult = { done: 0, retried: 0, gaveUp: 0, lost: 0 }
  const swept = await db.rpc('sweep_wa_meta_inbox')
  const givenUp: string[] = Array.isArray(swept?.data) ? swept.data.map((r: any) => String(r?.sender || r)).filter((x: string) => /^\d{8,15}$/.test(x)) : []
  if (givenUp.length) {
    out.gaveUp = givenUp.length
    console.error('WHATSAPP_META_INBOX_GAVE_UP:', JSON.stringify({ senders: givenUp.length }))
    for (const sender of givenUp) await (opts.notify || askToResend)(sender).catch(() => {})
  }
  const claimed = await db.rpc('claim_wa_meta_inbox', { p_limit: 10, p_lease_seconds: 150 })
  if (claimed?.error) { console.error('WHATSAPP_META_INBOX_CLAIM_FAILED:', JSON.stringify({ code: String(claimed.error.code || '').slice(0, 12) })); return out }
  const rows: any[] = Array.isArray(claimed?.data) ? claimed.data : []
  await Promise.all(rows.map(async row => {
    const { result, status } = await forward(row.params || {})
    const now = Date.now()
    const patch = result === 'retry'
      ? { status: 'pending', lease_id: null, lease_until: null, last_status: status, next_attempt_at: new Date(now + retryDelayMs(row.attempts)).toISOString() }
      // Handed over (or answered Busy, which is final): the row keeps no message text.
      : { status: 'done', params: null, lease_id: null, lease_until: null, last_status: status, finished_at: new Date(now).toISOString() }
    const res = await db.from('wa_meta_inbox').update(patch).eq('message_id', row.message_id).eq('lease_id', row.lease_id).select('message_id')
    if (res?.error || !Array.isArray(res?.data) || !res.data.length) {
      // The claim was lost (lease expired and someone else took it) or the write failed: the other worker, or the
      // lease expiry, decides what happens next. Nothing is counted here.
      out.lost++
      console.error('WHATSAPP_META_INBOX_FINISH_NOT_RECORDED:', JSON.stringify({ code: String(res?.error?.code || 'lease').slice(0, 12) }))
      return
    }
    if (result === 'retry') out.retried++; else out.done++
  }))
  return out
}

/** Tells a person their message could not be handled, so it is not silently lost. Best effort, through Meta (they
 *  wrote to the Meta number within the last six hours, so the conversation window is open). */
async function askToResend(sender: string) {
  const { metaSend, metaTextPayload } = await import('./meta')
  await metaSend(metaTextPayload(sender, "Sorry, I couldn't handle a message you sent me a few hours ago. Please send it again."))
}
