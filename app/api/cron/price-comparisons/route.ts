import {NextResponse} from 'next/server'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {resolveAgentActor} from '@/lib/agent/actor'
import {advancePriceComparison, comparisonLink} from '@/lib/commerce/price-comparison'
import {comparisonState, comparisonSummary} from '@/lib/commerce/comparison-model'
import {sendWhatsApp} from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error: 'unauthorized'}, {status: 401})
  try {
    const {data: rows, error} = await supabaseAdmin.from('agent_runs').select('id,telegram_id')
      .eq('type', 'price_comparison').in('status', ['queued', 'running'])
      .order('updated_at', {ascending: true}).limit(1)
    if (error) throw new Error('comparison_queue_read_failed')
    for (const row of rows || []) {
      const actor = await resolveAgentActor({telegramId: String(row.telegram_id), surface: 'web'})
      const task = await advancePriceComparison(actor, row.id)
      if (!task || comparisonState(task.metadata_json.providers) === 'queued') continue
      const text = comparisonSummary(task) + '\n\nSaved comparison: ' + comparisonLink(task.id)
      // Claim terminal delivery once. Provider failures remain visible in the
      // saved report even if WhatsApp delivery itself fails.
      const {data: claimed, error: claimError} = await supabaseAdmin.from('agent_runs')
        .update({metadata_json: {...task.metadata_json, notified: true}})
        .eq('id', task.id).eq('telegram_id', String(actor.legacyTelegramId))
        .is('metadata_json->>notified', null).select('id').maybeSingle()
      if (claimError) throw new Error('comparison_notification_claim_failed')
      if (claimed) {
        const {error: conversationError} = await supabaseAdmin.from('conversations').insert({telegram_id: actor.legacyTelegramId, role: 'assistant', content: text})
        if (conversationError) throw new Error('comparison_conversation_save_failed')
        if (task.source === 'whatsapp' && actor.whatsappId) await sendWhatsApp(actor.whatsappId, text)
      }
    }
    return NextResponse.json({ok: true, checked: rows?.length || 0})
  } catch (error) {
    console.error('PRICE_COMPARISON_WORKER_FAILED', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({error: 'comparison_worker_failed'}, {status: 500})
  }
}
