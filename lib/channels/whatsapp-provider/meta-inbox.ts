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

/** Stores verified messages. A redelivered message id is ignored. Returns false only when storing failed. */
export async function storeInbound(rows: { id: string; from: string; params: Record<string, string> }[], db: Db = supabaseAdmin as any): Promise<boolean> {
  if (!rows.length) return true
  const res = await db.from('wa_meta_inbox').upsert(rows.map(r => ({ message_id: r.id, sender: r.from, params: r.params })), { onConflict: 'message_id', ignoreDuplicates: true })
  if (res?.error) { console.error('WHATSAPP_META_INBOX_STORE_FAILED:', JSON.stringify({ code: String(res.error.code || '').slice(0, 12) })); return false }
  return true
}

/** Works the inbox until it is empty or the time budget is spent. Safe to run from several places at once. */
export async function drainMetaInbox(opts: { db?: Db; budgetMs?: number; forward?: typeof forwardToPipeline } = {}): Promise<{ done: number; retried: number; failed: number }> {
  const db = opts.db || (supabaseAdmin as any), forward = opts.forward || forwardToPipeline
  const started = Date.now(), budget = opts.budgetMs ?? 100_000
  const out = { done: 0, retried: 0, failed: 0 }
  while (Date.now() - started < budget) {
    const claimed = await db.rpc('claim_wa_meta_inbox', { p_limit: 10, p_lease_seconds: 150 })
    if (claimed?.error) { console.error('WHATSAPP_META_INBOX_CLAIM_FAILED:', JSON.stringify({ code: String(claimed.error.code || '').slice(0, 12) })); break }
    const rows: any[] = Array.isArray(claimed?.data) ? claimed.data : []
    const doneBefore = out.done + out.failed
    if (!rows.length) break
    // Different people in parallel; each person's messages one at a time (the claim gives at most one per person).
    await Promise.all(rows.map(async row => {
      const { result, status } = await forward(row.params || {})
      const now = new Date().toISOString()
      if (result === 'retry' && row.attempts < 5) {
        await db.from('wa_meta_inbox').update({ status: 'pending', lease_until: null, last_status: status }).eq('message_id', row.message_id)
        out.retried++
        return
      }
      const finished = result === 'retry' ? 'failed' : 'done'
      // A finished row keeps no message text.
      await db.from('wa_meta_inbox').update({ status: finished, params: null, lease_until: null, last_status: status, finished_at: now }).eq('message_id', row.message_id)
      if (finished === 'failed') { out.failed++; console.error('WHATSAPP_META_INBOX_GAVE_UP:', JSON.stringify({ status, attempts: row.attempts })) } else out.done++
    }))
    // A round where nothing went through means the pipeline is not taking messages: leave the rest for the next run.
    if (out.done + out.failed === doneBefore) break
  }
  return out
}
