import { randomUUID } from 'node:crypto'
import { deliveryRpc } from './reminder-delivery'
import { isDefiniteProviderRejection } from './delivery-state'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function deliverNotification(p: {
  key: string; source: 'briefing' | 'followup'; owner: number; channel: 'whatsapp' | 'email'; due: string
  prepare: () => Promise<void>; ready: () => Promise<boolean>; send: (token: string) => Promise<string>
  accepted?: (id: string) => Promise<void>; deadline: number
}): Promise<string> {
  const token = randomUUID()
  let claimed = false, started = false, returned = false
  try {
    claimed = await deliveryRpc('claim_notification_delivery', { p_key: p.key, p_source: p.source, p_owner: p.owner,
      p_channel: p.channel, p_due: p.due, p_token: token })
    if (!claimed) return 'skipped'
    await p.prepare()
    if (Date.now() >= p.deadline) return 'deferred' // unstarted lease recovers
    if (!await p.ready()) {
      if (!await deliveryRpc('finish_notification_delivery', { p_key: p.key, p_token: token, p_state: 'suppressed' })) throw new Error('suppression_write_failed')
      return 'suppressed'
    }
    if (!await deliveryRpc('begin_notification_delivery', { p_key: p.key, p_token: token })) return 'skipped'
    started = true
    const id = await p.send(token)
    returned = true
    if (!id) throw new Error('provider_id_missing')
    if (!await deliveryRpc('finish_notification_delivery', { p_key: p.key, p_token: token, p_state: 'provider_accepted', p_provider_id: id })) throw new Error('acceptance_write_failed')
    await deliveryRpc('reconcile_delivery_receipt', { p_sid: id })
    await p.accepted?.(id)
    return 'provider_accepted'
  } catch (error) {
    if (claimed && !returned && (!started || isDefiniteProviderRejection(error))) {
      try { await deliveryRpc('retry_notification_delivery', { p_key: p.key, p_token: token, p_definite: started }) }
      catch { return 'persistence_failed' }
      return 'failed'
    }
    return started ? 'outcome_unknown' : 'persistence_failed'
  }
}

// Provider read-back is evidence; a successful POST/ID is not. Poll only a bounded
// oldest-checked set using the existing briefing invocation, never another scheduler.
export async function reconcileBriefingEmailReceipts(deadline: number) {
  const { data, error } = await supabaseAdmin.from('notification_deliveries').select('delivery_key, provider_id, claim_token')
    .eq('channel', 'email').eq('state', 'provider_accepted').order('receipt_checked_at', { ascending: true, nullsFirst: true }).limit(10)
  if (error) throw new Error('email_receipt_queue_failed')
  let failures = 0
  for (const job of data || []) {
    if (Date.now() >= deadline) break
    try {
      const id = String(job.provider_id || '').replace(/^resend:/, '')
      const response = await fetch('https://api.resend.com/emails/' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + (process.env.RESEND_API_KEY || '') }, signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('email_receipt_provider_unavailable')
      const body = await response.json()
      if (body.id !== id) throw new Error('email_receipt_id_mismatch')
      const state = ['delivered', 'opened', 'clicked'].includes(body.last_event) ? 'delivered'
        : ['bounced', 'failed', 'suppressed'].includes(body.last_event) ? 'failed' : null
      if (state) {
        await deliveryRpc('record_delivery_receipt', { p_sid: job.provider_id, p_status: state, p_verified: true,
          p_token: job.claim_token, p_chunk: 1, p_chunks: 1 })
        await deliveryRpc('reconcile_delivery_receipt', { p_sid: job.provider_id })
      }
    } catch { failures++ }
    const { error: updateError } = await supabaseAdmin.from('notification_deliveries')
      .update({ receipt_checked_at: new Date().toISOString() }).eq('delivery_key', job.delivery_key)
    if (updateError) failures++
  }
  return failures
}
