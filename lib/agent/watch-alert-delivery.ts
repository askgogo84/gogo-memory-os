import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { recordCostEvent } from '@/lib/services/cost-guard'
import { deliverNotification } from '@/lib/services/notification-delivery'

// Reuse the receipt-backed notification ledger. A watch alert is a follow-up;
// its stable key is distinct from reminder/briefing jobs. Acceptance is NOT delivery.
export async function deliverWatchAlert(params: {
  watcherId: string; owner: string; key: string; due: string; message: string; condition: unknown
}) {
  const owner = Number(params.owner)
  if (!Number.isSafeInteger(owner)) throw new Error('watch_alert_owner_invalid')
  let phone = ''
  const status = await deliverNotification({
    key: params.key, source: 'followup', owner, channel: 'whatsapp', due: params.due,
    deadline: Date.now() + 30_000,
    prepare: async () => {
      const { data, error } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', owner).maybeSingle()
      if (error || !data?.whatsapp_id) throw new Error('watch_alert_recipient_unavailable')
      phone = String(data.whatsapp_id)
    },
    ready: async () => {
      const { data, error } = await supabaseAdmin.from('agent_watchers').select('active,condition_json')
        .eq('id', params.watcherId).eq('telegram_id', params.owner).maybeSingle()
      if (error) throw new Error('watch_alert_owner_read_failed')
      // An intervening stop or correction revokes the old notification.
      return data?.active === true && JSON.stringify(data.condition_json) === JSON.stringify(params.condition)
    },
    accepted: async () => { await recordCostEvent({telegramId:params.owner,category:'whatsapp_outbound',metadata:{source:'background_gogo',watcher_id:params.watcherId}}).catch(()=>{}) },
    send: async token => String((await sendWhatsApp(phone, params.message, null, token))?.sid || ''),
  })
  const { data, error } = await supabaseAdmin.from('notification_deliveries').select('state,provider_id')
    .eq('delivery_key', params.key).eq('owner_id', owner).maybeSingle()
  if (error) throw new Error('watch_alert_receipt_read_failed')
  const state = String(data?.state || status)
  return { state, accepted: ['provider_accepted', 'delivered', 'read'].includes(state), providerId: data?.provider_id || null }
}
