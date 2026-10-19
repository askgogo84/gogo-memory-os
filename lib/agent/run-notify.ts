// One WhatsApp message when a persistent/autonomous run finishes, fails or is closed as stale (19 Oct).
// Before this, reconcileRun only wrote activity and the stale sweep failed runs silently, so the owner
// learned the outcome only from the 3-hour pulse or by opening the dashboard.
//
// metadata_json.outcome_notified_at is the idempotency key: checked before the send, set only after a
// successful send. A failed send leaves it unset and never throws into the cron.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type RunOutcomeLike = {
  id?: string | number | null
  telegram_id?: string | number | null
  type?: string | null
  status?: string | null
  title?: string | null
  summary?: string | null
  error?: string | null
  metadata_json?: Record<string, any> | null
}

export type RunNotifyDeps = {
  db?: any
  send?: (to: string, text: string) => Promise<unknown>
  resolveWhatsappId?: (telegramId: string) => Promise<string | null>
  now?: () => Date
}

export type RunNotifyResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

// secure_browser runs are announced by approved-browser-worker / the background browser worker.
const SELF_NOTIFYING_TYPES = new Set(['secure_browser'])

const GENERIC_SUMMARIES = new Set([
  'completed and verified.',
  'i’m working through this request.',
  "i'm working through this request.",
])

const SENSITIVE_WORDS = /\b(otp|one[- ]time (?:code|password)|password|passcode|passwd|pin|cvv|secret|vault|credential)s?\b/i

function clean(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function stripEndPunctuation(value: string) {
  return value.replace(/[.!?\s]+$/, '')
}

function noticeTitle(run: RunOutcomeLike) {
  const title = stripEndPunctuation(clean(run.title, 140))
  // A title is the person's own request text; never echo it back if it carries a code or secret.
  if (!title || SENSITIVE_WORDS.test(title)) return 'your task'
  return title
}

function isStale(run: RunOutcomeLike) {
  return clean(run.error, 160) === 'stale_run_recovered'
}

function isUncertain(run: RunOutcomeLike) {
  const meta = run.metadata_json || {}
  const status = clean(run.status, 40)
  return status === 'outcome_unknown'
    || clean(meta.outcome_state, 40) === 'unknown'
    || meta.reconciliation_required === true
}

function plainReason(run: RunOutcomeLike) {
  const code = clean(run.error, 300).toLowerCase()
  if (code === 'stale_run_recovered' || code.startsWith('stale_worker')) return 'It stopped responding, so I closed it'
  if (code.includes('verification_failed')) return 'I couldn’t verify the result'
  if (code.startsWith('autonomous_tool_missing')) return 'One step needed something I can’t do yet'
  if (code.includes('approval')) return 'It needed an approval that didn’t come through'
  if (code.includes('timeout') || code.includes('timed out')) return 'It took too long to respond'
  return 'One step hit a problem I couldn’t safely get past'
}

/** The single owner-facing line for a finished run. Pure: no I/O. Never claims success it cannot see. */
export function completionNotice(run: RunOutcomeLike) {
  const title = noticeTitle(run)
  const status = clean(run.status, 40)
  const unsure = `I couldn't confirm whether ${title} finished. I haven't retried it.`
  if (isUncertain(run)) return unsure
  if (status === 'failed' || isStale(run)) {
    return `Stopped: ${title}. ${plainReason(run)}. Nothing was repeated or submitted again.`
  }
  if (status !== 'completed') return unsure
  const summary = clean(run.summary, 300)
  const extra = summary && !GENERIC_SUMMARIES.has(summary.toLowerCase()) && !SENSITIVE_WORDS.test(summary) ? ` ${summary}` : ''
  return `Done: ${title}.${extra}`
}

async function defaultResolveWhatsappId(telegramId: string) {
  // Same owner lookup the approved-browser worker uses (users.telegram_id -> whatsapp_id).
  const { actorForTelegramId } = await import('./approved-browser-worker')
  const actor = await actorForTelegramId(telegramId)
  return actor?.whatsappId || null
}

async function defaultSend(to: string, text: string) {
  const { sendWhatsApp } = await import('@/lib/whatsapp')
  return sendWhatsApp(to, text)
}

/** Send the outcome notice once. Never throws. */
export async function notifyRunOutcome(run: RunOutcomeLike, deps: RunNotifyDeps = {}): Promise<RunNotifyResult> {
  try {
    const runId = clean(run?.id, 80)
    const telegramId = clean(run?.telegram_id, 40)
    if (!runId || !telegramId) return { status: 'skipped', reason: 'missing_run_identity' }
    const meta = run.metadata_json || {}
    if (SELF_NOTIFYING_TYPES.has(clean(run.type, 60)) || SELF_NOTIFYING_TYPES.has(clean(meta.plan_type, 60))) {
      return { status: 'skipped', reason: 'self_notifying_run' }
    }
    if (meta.outcome_notified_at) return { status: 'skipped', reason: 'already_notified' }
    // Travel research / web comparison mark notified:true after sending their own result.
    if (meta.notified === true) return { status: 'skipped', reason: 'worker_already_notified' }

    const db = deps.db || supabaseAdmin
    const { data: latest, error: readError } = await db.from('agent_runs')
      .select('metadata_json').eq('id', runId).eq('telegram_id', telegramId).maybeSingle()
    if (readError) return { status: 'failed', reason: 'run_read_failed' }
    const latestMeta = (latest?.metadata_json || meta || {}) as Record<string, any>
    if (latestMeta.outcome_notified_at || latestMeta.notified === true) return { status: 'skipped', reason: 'already_notified' }

    const whatsappId = await (deps.resolveWhatsappId || defaultResolveWhatsappId)(telegramId)
    if (!whatsappId) return { status: 'skipped', reason: 'no_whatsapp_id' }

    const text = completionNotice({ ...run, metadata_json: latestMeta })
    try {
      await (deps.send || defaultSend)(whatsappId, text)
    } catch (err: any) {
      console.error('RUN_OUTCOME_NOTICE_SEND_FAILED:', runId, clean(err?.message || err, 200))
      return { status: 'failed', reason: 'send_failed' }
    }

    const at = (deps.now ? deps.now() : new Date()).toISOString()
    const { error: writeError } = await db.from('agent_runs')
      .update({ metadata_json: { ...latestMeta, outcome_notified_at: at } })
      .eq('id', runId).eq('telegram_id', telegramId)
    if (writeError) console.error('RUN_OUTCOME_NOTICE_FLAG_FAILED:', runId, writeError.message)
    return { status: 'sent' }
  } catch (err: any) {
    console.error('RUN_OUTCOME_NOTICE_FAILED:', clean(err?.message || err, 200))
    return { status: 'failed', reason: 'unexpected' }
  }
}
