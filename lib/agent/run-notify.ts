// One WhatsApp message when a persistent/autonomous run finishes, fails or is closed as stale (19 Oct).
// Before this, reconcileRun only wrote activity and the stale sweep failed runs silently, so the owner
// learned the outcome only from the 3-hour pulse or by opening the dashboard.
//
// The owner-bound claim is a write-ahead send intent. An expired claim may already
// have reached the provider: never reclaim it without delivery reconciliation.
// Only a definite provider rejection releases a claim for retry.
import { deliverRunOutcomeNotice } from './run-outcome-delivery'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDefiniteProviderRejection } from '@/lib/services/delivery-state'

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
  send?: (to: string, text: string, token?: string) => Promise<unknown>
  resolveWhatsappId?: (telegramId: string) => Promise<string | null>
  now?: () => Date
}

export type RunNotifyResult =
  | { status: 'sent' }
  | { status: 'provider_accepted' | 'deferred' | 'suppressed' | 'outcome_unknown' }
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

// A raw 4-8 digit code next to sign-in / verify / code / use words ("use 482913 to sign in").
const CODE_NEAR_AUTH = /(?:\b(?:use|enter|sign[\s-]?in|log[\s-]?in|signin|login|verify|verification|code|confirm)\b\D{0,24}\b\d{4,8}\b|\b\d{4,8}\b\D{0,24}\b(?:to\s+)?(?:use|enter|sign[\s-]?in|log[\s-]?in|signin|login|verify|verification|code|confirm)\b)/i

const CLAIM_KEYS = ['outcome_notice_claimed_at', 'outcome_notice_claim_id'] as const

function clean(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function stripEndPunctuation(value: string) {
  return value.replace(/[.!?\s]+$/, '')
}

function noticeTitle(run: RunOutcomeLike) {
  const title = stripEndPunctuation(clean(run.title, 140))
  // A title is the person's own request text; never echo it back if it carries a code or secret.
  if (!title || SENSITIVE_WORDS.test(title) || CODE_NEAR_AUTH.test(title)) return 'your task'
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
  const extra = summary && !GENERIC_SUMMARIES.has(summary.toLowerCase()) && !SENSITIVE_WORDS.test(summary) && !CODE_NEAR_AUTH.test(summary) ? ` ${summary}` : ''
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

function withoutClaim(meta: Record<string, any>) {
  const next = { ...meta }
  for (const key of CLAIM_KEYS) delete next[key]
  return next
}

function claimToken() {
  const c: any = (globalThis as any).crypto
  if (c?.randomUUID) return String(c.randomUUID())
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

async function readMeta(db: any, runId: string, telegramId: string) {
  const { data, error } = await db.from('agent_runs')
    .select('metadata_json').eq('id', runId).eq('telegram_id', telegramId).maybeSingle()
  if (error) return { ok: false as const }
  return { ok: true as const, found: Boolean(data), meta: (data?.metadata_json || {}) as Record<string, any> }
}

/** Drop our claim (only if it is still ours), merged into fresh metadata. Best effort. */
async function releaseClaim(db: any, runId: string, telegramId: string, token: string) {
  try {
    const fresh = await readMeta(db, runId, telegramId)
    if (!fresh.ok || !fresh.found || fresh.meta.outcome_notice_claim_id !== token) return
    const { error } = await db.from('agent_runs')
      .update({ metadata_json: withoutClaim(fresh.meta) })
      .eq('id', runId).eq('telegram_id', telegramId)
      .eq('metadata_json->>outcome_notice_claim_id', token)
    if (error) console.error('RUN_OUTCOME_NOTICE_RELEASE_FAILED:', runId, clean(error.message, 200))
  } catch (err: any) {
    console.error('RUN_OUTCOME_NOTICE_RELEASE_FAILED:', runId, clean(err?.message || err, 200))
  }
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
    const nowDate = () => (deps.now ? deps.now() : new Date())
    const first = await readMeta(db, runId, telegramId)
    if (!first.ok) return { status: 'failed', reason: 'run_read_failed' }
    if (!first.found) return { status: 'skipped', reason: 'run_not_found' }
    const latestMeta = first.meta
    // Newly requested background notices use the receipt ledger. Legacy uncertain
    // JSON intents remain on the conservative compatibility path below.
    if (latestMeta.outcome_notice_requested === true) return deliverRunOutcomeNotice(runId, telegramId, completionNotice, deps)
    if (latestMeta.outcome_notified_at || latestMeta.notified === true) return { status: 'skipped', reason: 'already_notified' }
    if (SELF_NOTIFYING_TYPES.has(clean(latestMeta.plan_type, 60))) return { status: 'skipped', reason: 'self_notifying_run' }

    // A crashed sender may have reached the provider even if no ID/flag was persisted.
    // Fail closed on legacy claims too; age is not proof of non-delivery.
    const existingClaim = clean(latestMeta.outcome_notice_claimed_at, 60)
    if (existingClaim || latestMeta.outcome_notice_claim_id) {
      return { status: 'skipped', reason: 'reconciliation_required' }
    }

    const whatsappId = await (deps.resolveWhatsappId || defaultResolveWhatsappId)(telegramId)
    if (!whatsappId) return { status: 'skipped', reason: 'no_whatsapp_id' }

    // Claim: conditional, owner-bound, and confirmed by the number of rows it changed.
    const token = claimToken()
    let claim = db.from('agent_runs')
      .update({ metadata_json: { ...latestMeta, outcome_notice_claimed_at: nowDate().toISOString(), outcome_notice_claim_id: token } })
      .eq('id', runId).eq('telegram_id', telegramId)
      .is('metadata_json->>outcome_notified_at', null)
    claim = existingClaim
      ? claim.eq('metadata_json->>outcome_notice_claimed_at', existingClaim)
      : claim.is('metadata_json->>outcome_notice_claimed_at', null)
    const { data: claimed, error: claimError } = await claim.select('id')
    if (claimError) return { status: 'failed', reason: 'claim_failed' }
    if (!Array.isArray(claimed) || claimed.length !== 1) return { status: 'skipped', reason: 'claimed_elsewhere' }

    const text = completionNotice({ ...run, metadata_json: latestMeta })
    try {
      await (deps.send || defaultSend)(whatsappId, text)
    } catch (err: any) {
      console.error('RUN_OUTCOME_NOTICE_SEND_FAILED:', runId, clean(err?.message || err, 200))
      if (isDefiniteProviderRejection(err)) {
        await releaseClaim(db, runId, telegramId, token)
        return { status: 'failed', reason: 'send_failed' }
      }
      return { status: 'failed', reason: 'outcome_unknown' }
    }

    // Sent: record the flag on top of whatever other paths wrote since the claim.
    // One persistence retry: if neither write lands, the send intent stays and blocks replay.
    const at = nowDate().toISOString()
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await readMeta(db, runId, telegramId)
      const base = fresh.ok && fresh.found ? fresh.meta : latestMeta
      const { error: writeError } = await db.from('agent_runs')
        .update({ metadata_json: { ...withoutClaim(base), outcome_notified_at: at } })
        .eq('id', runId).eq('telegram_id', telegramId)
      if (!writeError) break
      console.error('RUN_OUTCOME_NOTICE_FLAG_FAILED:', runId, writeError.message)
    }
    return { status: 'sent' }
  } catch (err: any) {
    console.error('RUN_OUTCOME_NOTICE_FAILED:', clean(err?.message || err, 200))
    return { status: 'failed', reason: 'unexpected' }
  }
}
