import {NextResponse} from 'next/server'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {resolveAgentActor} from '@/lib/agent/actor'
import {advancePriceComparison, readPriceComparison} from '@/lib/commerce/price-comparison'
import {deliverCompletedComparison} from '@/lib/commerce/comparison-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error: 'unauthorized'}, {status: 401})
  try {
    const deadline = Date.now() + 270_000
    const {data: rows, error} = await supabaseAdmin.from('agent_runs').select('id,telegram_id')
      .eq('type', 'price_comparison').in('status', ['queued', 'running'])
      .order('updated_at', {ascending: true}).limit(1)
    if (error) throw new Error('comparison_queue_read_failed')
    let advanceFailures = 0
    for (const row of rows || []) {
      if (Date.now() >= deadline) break
      try {
        const actor = await resolveAgentActor({telegramId: String(row.telegram_id), surface: 'web'})
        await advancePriceComparison(actor, row.id)
      } catch (error) {
        advanceFailures++
        console.error('PRICE_COMPARISON_ADVANCE_FAILED:', {runId: row.id, error: error instanceof Error ? error.message : 'unknown'})
      }
    }
    // Scan terminal tasks separately: a Twilio rejection must not strand a
    // completed browser result after its agent_run leaves the active queue.
    const {data: terminal, error: terminalError} = await supabaseAdmin.from('agent_runs')
      .select('id,telegram_id').eq('type', 'price_comparison').eq('source', 'whatsapp')
      .in('status', ['completed', 'paused']).is('metadata_json->>notified', null)
      .order('updated_at', {ascending: false}).limit(20)
    if (terminalError) throw new Error('comparison_delivery_queue_read_failed')
    let attempted = 0
    let deliveryFailures = 0
    for (const row of terminal || []) {
      if (Date.now() >= deadline || attempted >= 5) break
      try {
        const actor = await resolveAgentActor({telegramId: String(row.telegram_id), surface: 'web'})
        const task = await readPriceComparison(String(row.telegram_id), row.id)
        if (!task) continue
        const status = await deliverCompletedComparison(task, actor, deadline)
        if (['failed', 'persistence_failed', 'outcome_unknown'].includes(status)) {
          deliveryFailures++
          console.error('PRICE_COMPARISON_DELIVERY_UNSENT:', {runId: task.id, status})
        }
        if (status !== 'skipped') attempted++
      } catch (error) {
        deliveryFailures++
        console.error('PRICE_COMPARISON_DELIVERY_FAILED:', {runId: row.id, error: error instanceof Error ? error.message : 'unknown'})
      }
    }
    return NextResponse.json({ok: true, checked: rows?.length || 0, advanceFailures, deliveryAttempts: attempted, deliveryFailures})
  } catch (error) {
    console.error('PRICE_COMPARISON_WORKER_FAILED', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({error: 'comparison_worker_failed'}, {status: 500})
  }
}
