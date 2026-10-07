import {supabaseAdmin} from '@/lib/supabase-admin'
import {deliverNotification} from '@/lib/services/notification-delivery'
import {sendWhatsApp} from '@/lib/whatsapp'
import type {AgentActor} from '@/lib/agent/actor'
import {comparisonState, comparisonWhatsAppSummary, type PriceComparison} from './comparison-model'
import {comparisonLink, comparisonWebFallback, readPriceComparison} from './price-comparison'

/** The notification outbox owns retries and callback receipts for a finished read. */
export async function deliverCompletedComparison(task: PriceComparison, actor: AgentActor, deadline: number) {
  const owner = Number(actor.legacyTelegramId)
  const recipient = actor.whatsappId || ''
  let current: PriceComparison | null = null
  let message = ''

  return deliverNotification({
    key: `price_comparison/${task.id}`, source: 'price_comparison', owner,
    channel: 'whatsapp', due: task.updated_at, deadline,
    prepare: async () => {
      current = await readPriceComparison(String(owner), task.id)
      if (!current || comparisonState(current.metadata_json.providers) === 'queued') throw new Error('comparison_not_terminal')
      const fallback = await comparisonWebFallback(current)
      message = comparisonWhatsAppSummary(current) + (fallback ? '\n\n' + fallback : '') +
        '\n\nFull saved report: ' + comparisonLink(task.id)
    },
    ready: async () => {
      if (!recipient) return false
      const {data, error} = await supabaseAdmin.from('agent_runs')
        .select('status,source').eq('id', task.id).eq('telegram_id', String(owner)).eq('type', 'price_comparison').maybeSingle()
      if (error) throw new Error('comparison_delivery_read_failed')
      return Boolean(data && data.source === 'whatsapp' && ['completed', 'paused'].includes(data.status))
    },
    send: async token => {
      // A callback adds recipient-delivery proof when configured. Provider
      // acceptance still works without it, so missing optional config cannot
      // strand the result before Twilio is even called.
      const receiptToken = process.env.TWILIO_STATUS_CALLBACK_URL ? token : undefined
      try {
        const sent = await sendWhatsApp(recipient, message, undefined, receiptToken)
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
