import {supabaseAdmin} from '@/lib/supabase-admin'
import {commerceTaskLink, commerceTaskView, readCommerceTask} from '@/lib/commerce/task'

// Deliberately explicit: a paused grocery task never claims PINs, amounts or ordinary chat.
export async function tryGroceryComparison(params: {telegramId: number; text: string; surface?: string}) {
  const create = params.text.trim().match(/^compare grocery prices for\s+(.{1,180})$/i)
  const status = /^\s*(?:show|check)\s+(?:my|the)\s+grocery comparison(?: status)?[.!]?\s*$/i.test(params.text)
  if (!create && !status) return null
  const owner = String(params.telegramId)
  let task
  if (create) {
    const subject = create[1].trim()
    if (!subject) return null
    const now = new Date().toISOString()
    const {data, error} = await supabaseAdmin.from('agent_runs').insert({
      telegram_id: owner, type: 'grocery_comparison', capability: 'browser', status: 'paused',
      title: 'Compare groceries: ' + subject, progress: 0, source: params.surface || 'whatsapp', started_at: now, updated_at: now,
      summary: 'Open this comparison and choose Use browser to look up ' + subject + ' on Instamart, Zepto or Blinkit. You can also use a connected Swiggy account when available. Zepto comparison awaits verified provider results. Prices, delivery fees and cart contents are not verified. Nothing has been ordered.',
      metadata_json: {plan_type: 'grocery_comparison', state: 'provider_connection_required', subject, request_text: params.text, service: 'grocery'},
    }).select('id,type,status,updated_at,summary,metadata_json').single()
    if (error || !data?.id) throw new Error('grocery_comparison_create_failed')
    task = data
  } else {
    const {data, error} = await supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', owner).eq('type', 'grocery_comparison').order('started_at', {ascending: false}).limit(1).maybeSingle()
    if (error) throw new Error('grocery_comparison_read_failed')
    task = data ? await readCommerceTask(owner, data.id) : null
  }
  return {runId: task?.id || '', status: 'paused' as const, capability: 'browser' as const, risk: 'low' as const, handledBy: 'grocery-comparison' as const,
    text: task ? commerceTaskView(task).summary + '\n\nContinue this comparison: ' + commerceTaskLink(task.id) : 'There is no active grocery comparison.'}
}
