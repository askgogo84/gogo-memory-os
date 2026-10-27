import {supabaseAdmin} from '@/lib/supabase-admin'
import {deliverNotification} from '@/lib/services/notification-delivery'
import {sendWhatsApp} from '@/lib/whatsapp'
import type {AgentActor} from '@/lib/agent/actor'
import {comparisonState, comparisonWhatsAppSummary, type PriceComparison} from './comparison-model'
import {comparisonWebFallback, readPriceComparison} from './price-comparison'

// Defense in depth: private result delivery must not trust a rounded 64-bit
// actor ID or a stale recipient even if the normal actor resolver is guarded.
async function currentComparisonRecipient(actor: AgentActor): Promise<{ owner: number; recipient: string } | null> {
  const owner = actor?.legacyTelegramId
  const userId = String(actor?.userId || '').trim()
  const expectedPhone = String(actor?.whatsappId || '').trim()
  if (typeof owner !== 'number' || !Number.isSafeInteger(owner) || owner === 0 || !userId || !expectedPhone) return null
  try {
    const { data, error } = await supabaseAdmin.from('users')
      .select('id,telegram_id,whatsapp_id')
      .eq('id', userId).eq('telegram_id', String(owner)).maybeSingle()
    if (error || !data || String(data.id) !== userId) return null
    const storedId = data.telegram_id
    if (typeof storedId === 'number'
      ? !Number.isSafeInteger(storedId) || storedId !== owner
      : String(storedId) !== String(owner)) return null
    const recipient = String(data.whatsapp_id || '').trim()
    if (!recipient || recipient !== expectedPhone) return null
    return { owner, recipient }
  } catch {
    return null // unknown authorization never permits outbound private delivery
  }
}

/** The notification outbox owns retries and callback receipts for a finished read. */
export async function deliverCompletedComparison(task: PriceComparison, actor: AgentActor, deadline: number) {
  const binding = await currentComparisonRecipient(actor)
  if (!binding) return 'skipped'
  const { owner } = binding
  if(task.source==='web'){
    if(Date.now()>=deadline)return 'skipped'
    const current=await readPriceComparison(String(owner),task.id)
    if(!current||current.source!=='web'||comparisonState(current.metadata_json.providers)==='queued')return 'skipped'
    const fallback=await comparisonWebFallback(current)
    const content=comparisonWhatsAppSummary(current)+(fallback?'\n\n'+fallback:'')
    if(Date.now()>=deadline)return 'skipped'
    if (!(await currentComparisonRecipient(actor))) return 'skipped'
    // Publish and mark notified in one transaction. Overlapping workers cannot
    // duplicate history or lose the result between two database writes.
    const {data,error}=await supabaseAdmin.rpc('publish_web_comparison_result',{p_owner:String(owner),p_run_id:task.id,p_content:content})
    if(error)throw new Error('comparison_web_delivery_failed')
    return data===true?'history_published':'skipped'
  }
  if(task.source!=='whatsapp')return 'skipped'
  const recipient = binding.recipient
  let current: PriceComparison | null = null
  let message = ''

  return deliverNotification({
    key: `price_comparison/${task.id}`, source: 'price_comparison', owner,
    channel: 'whatsapp', due: task.updated_at, deadline,
    prepare: async () => {
      current = await readPriceComparison(String(owner), task.id)
      if (!current || current.source !== 'whatsapp' || comparisonState(current.metadata_json.providers) === 'queued') throw new Error('comparison_not_terminal')
      const fallback = await comparisonWebFallback(current)
      message = comparisonWhatsAppSummary(current) + (fallback ? '\n\n' + fallback : '')
    },
    ready: async () => {
      const latest = await currentComparisonRecipient(actor)
      if (!latest || latest.owner !== owner || latest.recipient !== recipient) return false
      const {data, error} = await supabaseAdmin.from('agent_runs')
        .select('status,source').eq('id', task.id).eq('telegram_id', String(owner)).eq('type', 'price_comparison').maybeSingle()
      if (error) throw new Error('comparison_delivery_read_failed')
      return Boolean(data && data.source === 'whatsapp' && ['completed', 'paused'].includes(data.status))
    },
    send: async token => {
      // Recheck immediately before the provider call. This is not atomic with Twilio.
      const latest = await currentComparisonRecipient(actor)
      if (!latest || latest.owner !== owner || latest.recipient !== recipient) throw new Error('comparison_delivery_owner_or_recipient_changed')
      // A callback adds recipient-delivery proof when configured. Provider
      // acceptance still works without it, so missing optional config cannot
      // strand the result before Twilio is even called.
      const receiptToken = process.env.TWILIO_STATUS_CALLBACK_URL ? token : undefined
      try {
        const sent = await sendWhatsApp(latest.recipient, message, undefined, receiptToken)
        return String(sent?.sid || '')
      } catch (error: any) {
        console.error('COMPARISON_WHATSAPP_SEND_FAILED:', {runId: task.id, status: error?.status || null, code: error?.code || null})
        throw error
      }
    },
    accepted: async () => {
      // Acceptance is not recipient delivery; the status callback owns that proof.
      // Keep notification persistence errors visible without retrying an accepted send.
      try {
        if (!current) return
        const {error} = await supabaseAdmin.from('agent_runs')
          .update({metadata_json: {...current.metadata_json, notified: true}})
          .eq('id', task.id).eq('telegram_id', String(owner)).is('metadata_json->>notified', null)
        if (error) throw error
        const {error: historyError} = await supabaseAdmin.from('conversations')
          .insert({telegram_id: owner, role: 'assistant', content: message})
        if (historyError) throw historyError
      } catch (error) {
        console.error('COMPARISON_ACCEPTED_HISTORY_FAILED:', error instanceof Error ? error.message : 'unknown')
      }
    },
  })
}
