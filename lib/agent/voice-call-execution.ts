import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { isDefiniteProviderRejection } from '@/lib/services/delivery-state'

// No provider credentials or dialogue in the claim identity. All effect-bearing fields are bound.
export function voicePlanHash(owner: string, plan: Record<string, unknown>) {
  const fields = ['venue','to','source','guestName','partySize','date','dateLabel','timeLabel','flexWindow','seating','purpose','test','createdAt','startClock']
  return createHash('sha256').update(JSON.stringify([owner, ...fields.map(key => plan[key] ?? null)])).digest('hex')
}
export function voiceAttemptId(owner: string, plan: Record<string, unknown>, attempt = Number(plan.redials || 0)) {
  const h = createHash('sha256').update(`voice-call-v1:${voicePlanHash(owner, plan)}:${attempt}`).digest('hex')
  // A deterministic UUID uses the existing run primary key as the cross-worker uniqueness boundary.
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}
const canonical = (text: string) => String(text || '').replace(/[*_\r]/g, '').replace(/\s+/g, ' ').trim()
const FINAL = new Set(['completed','failed','busy','no-answer','canceled','cancelled','balance-low','error'])
export type VoicePlacementResult = { status: 'started' | 'outcome_unknown' | 'rejected' | 'blocked'; runId?: string; executionId?: string; reason?: string }

/** Persist a one-shot send intent before touching the provider. Repeated approvals cannot call again. */
export async function beginApprovedVoiceCall(p: {
  owner: string; plan: Record<string, unknown>; approvedPlanHash: string; shownText: string; expectedText: string;
  surface: 'web' | 'whatsapp'; db: Pick<SupabaseClient,'from'>; place: () => Promise<string>; now?: Date;
}): Promise<VoicePlacementResult> {
  const now = p.now || new Date(), age = now.getTime() - Date.parse(String(p.plan.createdAt || ''))
  const attempt = Number(p.plan.redials || 0)
  if (!/^-?\d{1,16}$/.test(p.owner) || !Number.isSafeInteger(Number(p.owner)) || !/^\+91\d{10}$/.test(String(p.plan.to || ''))
    || !Number.isInteger(attempt) || attempt < 0 || attempt > 2) return { status: 'blocked', reason: 'invalid_call_plan' }
  if (!Number.isFinite(age) || age < 0 || age >= 15 * 60_000) return { status: 'blocked', reason: 'expired_call_plan' }
  if (!p.approvedPlanHash || p.approvedPlanHash !== voicePlanHash(p.owner, p.plan)) return { status: 'blocked', reason: 'call_plan_changed' }
  // A redial is an explicit request to retry this exact plan; ordinary yes must answer the exact shown card.
  if (attempt === 0 && (!canonical(p.expectedText) || !canonical(p.shownText) || canonical(p.shownText) !== canonical(p.expectedText))) return { status: 'blocked', reason: 'call_plan_not_latest' }
  if (attempt > 0) {
    const { data: previous, error } = await p.db.from('agent_runs').select('status,metadata_json')
      .eq('id', voiceAttemptId(p.owner, p.plan, attempt - 1)).eq('telegram_id', p.owner).maybeSingle()
    const meta = previous?.metadata_json || {}
    const rejected = previous?.status === 'failed' && meta.call_state === 'rejected'
    if (error || !previous || (!rejected && (!FINAL.has(String(meta.final_status || '')) || previous.status === 'running' || previous.status === 'outcome_unknown'))
      || meta.outcome?.booked === true || meta.reconciliation_required === true) return { status: 'blocked', reason: 'previous_call_requires_reconciliation' }
  }
  const runId = voiceAttemptId(p.owner, p.plan)
  const metadata = { plan_type: 'voice_call', plan: p.plan, approval_hash: p.approvedPlanHash,
    call_state: 'submitting', outcome_state: 'unknown', reconciliation_required: true }
  const { error: claimError } = await p.db.from('agent_runs').insert({
    id: runId, telegram_id: p.owner, type: 'voice_call', capability: 'contacts', status: 'running', progress: 10,
    title: `Call · ${String(p.plan.venue || '').slice(0,160)}`, summary: 'Preparing the approved call; result is not yet known.',
    source: p.surface, why: 'You approved this exact call plan.', metadata_json: metadata,
    started_at: now.toISOString(), updated_at: now.toISOString(),
  })
  if (claimError) return { status: 'blocked', reason: String(claimError.code) === '23505' ? 'call_already_attempted' : 'call_intent_persistence_failed' }

  let executionId = ''
  try {
    executionId = String(await p.place() || '')
    if (!executionId || executionId.length > 200) throw Error('voice_execution_id_missing')
    const { data, error } = await p.db.from('agent_runs').update({ progress: 20,
      summary: `Calling ${String(p.plan.venue).slice(0,160)}; awaiting provider result.`,
      metadata_json: { ...metadata, execution_id: executionId, call_state: 'provider_accepted', outcome_state: 'pending', reconciliation_required: false },
      updated_at: new Date().toISOString(),
    }).eq('id', runId).eq('telegram_id', p.owner).eq('status', 'running').eq('metadata_json->>call_state', 'submitting').select('id').maybeSingle()
    if (error || !data) throw Error('voice_acceptance_persistence_failed')
    return { status: 'started', runId, executionId }
  } catch (error) {
    const rejected = !executionId && isDefiniteProviderRejection(error)
    // Best effort only: the deterministic pre-call intent remains even if this write fails.
    try {
      await p.db.from('agent_runs').update({ status: rejected ? 'failed' : 'outcome_unknown',
        summary: rejected ? 'The provider rejected this call attempt.' : 'The call may have started. Do not repeat it until its outcome is checked.',
        metadata_json: { ...metadata, ...(executionId ? { execution_id: executionId } : {}), call_state: rejected ? 'rejected' : 'outcome_unknown',
          outcome_state: rejected ? 'failed' : 'unknown', reconciliation_required: !rejected },
        updated_at: new Date().toISOString(),
      }).eq('id', runId).eq('telegram_id', p.owner).eq('status', 'running')
    } catch { /* keep the persisted intent; never call a second time */ }
    return { status: rejected ? 'rejected' : 'outcome_unknown', runId, ...(executionId ? { executionId } : {}) }
  }
}
