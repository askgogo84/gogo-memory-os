import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import type { AgentActor } from './actor'
import { executeApprovedBrowserCommand } from './browser-command'

// Approved secure-browser runs are executed by ONE shared function, reached two ways:
//  1. triggerApprovedBrowserRun(): right after the user approves on WhatsApp, the webhook
//     calls the internal route below, which runs the browser with its own 300s budget.
//     The webhook itself (60s) never runs the browser.
//  2. The autonomous-runs cron sweeps any approved run still sitting in 'queued'.
// Both go through runApprovedBrowserRun(), whose optimistic queued->running claim means
// a run executes at most once even when both paths race.

export type ApprovedBrowserRunOutcome = 'skipped' | 'completed' | 'blocked' | 'failed'

export async function actorForTelegramId(telegramId: string): Promise<AgentActor | null> {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id', Number(telegramId)).maybeSingle()
  if (error) { console.error('APPROVED_BROWSER_ACTOR_FAILED:', error.message); return null }
  if (!data?.id || !data?.telegram_id) return null
  return {
    userId: String(data.id),
    legacyTelegramId: Number(data.telegram_id),
    whatsappId: String(data.whatsapp_id || ''),
    name: String(data.name || 'Gogo'),
  }
}

/** Claim one queued, approved, execute-mode secure-browser run and execute it once. */
export async function runApprovedBrowserRun(runId: string): Promise<ApprovedBrowserRunOutcome> {
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs')
    .select('id,telegram_id,type,status,metadata_json')
    .eq('id', runId).maybeSingle()
  if (runError) { console.error('APPROVED_BROWSER_RUN_READ_FAILED:', runError.message); return 'skipped' }
  if (!run || run.type !== 'secure_browser' || run.status !== 'queued') return 'skipped'
  const meta: any = run.metadata_json || {}
  if (meta.plan_type !== 'secure_browser' || meta.mode !== 'execute') return 'skipped'

  const { data: approvedRow } = await supabaseAdmin.from('agent_approvals')
    .select('id')
    .eq('run_id', run.id)
    .eq('telegram_id', String(run.telegram_id))
    .eq('status', 'approved')
    .limit(1)
    .maybeSingle()
  if (!approvedRow?.id) return 'skipped'

  // Optimistic claim: only the request that flips queued->running proceeds.
  const { data: claimed } = await supabaseAdmin.from('agent_runs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('telegram_id', String(run.telegram_id))
    .eq('status', 'queued')
    .select('id')
    .maybeSingle()
  if (!claimed?.id) return 'skipped'

  const actor = await actorForTelegramId(String(run.telegram_id))
  if (!actor) {
    const at = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({
      status: 'failed', error: 'approved_browser_actor_missing',
      summary: 'Gogo could not run this approved browser task because the user identity is unavailable.',
      completed_at: at, updated_at: at,
    }).eq('id', run.id).eq('telegram_id', String(run.telegram_id)).eq('status', 'running')
    return 'failed'
  }

  try {
    const result = await executeApprovedBrowserCommand({ actor, runId: String(run.id) })
    if (actor.whatsappId && result?.text) {
      await sendWhatsApp(actor.whatsappId,
        result.status === 'completed'
          ? `✅ Done. ${result.text}`
          : `Gogo could not finish this approved browser task safely.\n\n${result.text}`
      )
    }
    return result?.status === 'completed' ? 'completed' : 'blocked'
  } catch (err: any) {
    console.error('APPROVED_BROWSER_EXECUTION_FAILED:', run.id, err?.message || err)
    const at = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({
      status: 'failed',
      error: String(err?.message || 'approved_browser_execution_failed').slice(0, 500),
      summary: 'Gogo could not finish the approved browser task.',
      completed_at: at, updated_at: at,
    }).eq('id', run.id).eq('telegram_id', String(run.telegram_id)).eq('status', 'running')
    if (actor.whatsappId) {
      await sendWhatsApp(actor.whatsappId, 'Gogo could not finish the approved browser task. Nothing was repeated. Check the activity page before retrying.').catch(() => {})
    }
    return 'failed'
  }
}

function appBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.askgogo.in').replace(/\/$/, '')
}

/**
 * Called from the WhatsApp webhook after an approval. It hands the run to the internal route,
 * which answers 202 at once and runs the browser in its own 300s budget. Awaiting this costs
 * well under a second, so the webhook never runs the browser. Every outcome is logged, so a
 * failed hand-off is visible in the logs. If the hand-off fails, the cron sweeper is the fallback.
 */
export async function triggerApprovedBrowserRun(runId: string): Promise<'dispatched' | 'not_approved' | 'failed'> {
  const { data: approvedRow, error: approvedError } = await supabaseAdmin.from('agent_approvals')
    .select('id').eq('run_id', runId).eq('status', 'approved').limit(1).maybeSingle()
  if (approvedError) { console.error('APPROVED_BROWSER_TRIGGER_READ_FAILED:', runId, approvedError.message); return 'failed' }
  if (!approvedRow?.id) { console.error('APPROVED_BROWSER_TRIGGER_NOT_APPROVED:', runId); return 'not_approved' }
  const secret = process.env.CRON_SECRET
  if (!secret) { console.error('APPROVED_BROWSER_TRIGGER_NO_SECRET; cron sweeper will run:', runId); return 'failed' }
  const url = `${appBaseUrl()}/api/agent/approved-browser`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) { console.error('APPROVED_BROWSER_TRIGGER_REJECTED:', res.status, runId); return 'failed' }
    console.log('APPROVED_BROWSER_TRIGGERED:', runId, res.status)
    return 'dispatched'
  } catch (err: any) {
    console.error('APPROVED_BROWSER_TRIGGER_FAILED:', runId, url, err?.message || err)
    return 'failed'
  }
}
