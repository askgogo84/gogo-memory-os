import { supabaseAdmin } from '@/lib/supabase-admin'
import { retiredRunReason } from './task-lifecycle'

// 19 Oct (Muse/Wajo parity): "cancel that task" / "stop the flight booking" stops an in-flight
// agent run from chat. Watches (watch-command.ts), reminders, calendar events, lists, orders and
// Gmail drafts each have their own cancel paths, so this parser refuses any sentence naming them.

export type RunCancelIntent = {
  // null means "that / the task": the most recently updated active run.
  target: string | null
  // explicit: the sentence says task/job/mission, "stop working on" or "abort". A soft
  // "stop the <x>" is only claimed when exactly one active run matches <x> on two or more content
  // words; otherwise other handlers get it. A named target that matches no active run is never
  // claimed either (explicit or not), so "cancel the buy milk task" falls through.
  explicit: boolean
}

// agent_runs_status_check allows queued/running/watching/waiting_approval/completed/failed/paused/
// outcome_unknown. 'watching' belongs to watches; outcome_unknown is already terminal for the runtime.
export const CANCELLABLE_RUN_STATUSES = ['queued', 'running', 'waiting_approval', 'paused'] as const

const FOREIGN_OBJECT = /\b(?:remind(?:er|ers)?|watch(?:es|er|ers|ing)?|monitor(?:s|ing)?|tracking|track(?:er)?|alerts?|lists?|orders?|subscriptions?|e-?mails?|mails?|drafts?|gmail|meetings?|calendar|events?|alarms?|timers?|music|songs?|playlist|podcast|video|call|recording|notifications?|messages?|spam)\b/i
const VAGUE_TARGET = /^(?:that|this|it|the|current|last|latest|running|ongoing|active|everything|all of it)$/i
const RUN_NOUN = '(?:task|job|mission|run|agent task)'

function normalise(text: string) {
  return String(text || '')
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/^[\s"'“”`]+|[\s"'“”`.!?]+$/g, '')
    .replace(/^(?:hey\s+)?(?:gogo[,:]?\s+)?(?:please\s+|pls\s+|can you\s+|could you\s+|kindly\s+)*/i, '')
    .replace(/\s+please$/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
}

const BARE_RUN_NOUN = new RegExp(`^${RUN_NOUN}s?$`, 'i')

function cleanTarget(raw: string) {
  const target = String(raw || '')
    .replace(/^(?:the|my|your|that|this|current|ongoing|running|active)\s+/i, '')
    .replace(/^(?:the|my|your|that|this|current|ongoing|running|active)\s+/i, '')
    .trim()
  return target && !VAGUE_TARGET.test(target) && !BARE_RUN_NOUN.test(target) ? target.slice(0, 120) : null
}

export function parseRunCancel(text: string): RunCancelIntent | null {
  const t = normalise(text)
  if (!t || FOREIGN_OBJECT.test(t)) return null

  // "cancel that task", "stop the current task", "abort the job", "kill the running mission".
  // A determiner or qualifier is required: bare "abort mission" / "cancel task" is not claimed.
  if (new RegExp(`^(?:cancel|stop|abort|kill|end|halt)\\s+(?:(?:(?:that|this|the|my|your)\\s+)(?:(?:current|last|latest|running|ongoing|active)\\s+)?|(?:current|last|latest|running|ongoing|active)\\s+)${RUN_NOUN}$`, 'i').test(t)) {
    return { target: null, explicit: true }
  }
  // "stop what you're doing", "stop working on it", "stop working on that"
  if (/^(?:stop|cancel|abort)\s+(?:what you(?:'re| are) (?:doing|working on)|working on (?:it|that|this))$/i.test(t)) {
    return { target: null, explicit: true }
  }
  // "cancel the flight booking task", "stop my hotel search job"
  const named = t.match(new RegExp(`^(?:cancel|stop|abort|kill|end|halt)\\s+(?:the|my|your|that|this)\\s+(.+?)\\s+${RUN_NOUN}$`, 'i'))
  if (named) {
    const target = cleanTarget(named[1])
    return target ? { target, explicit: true } : null
  }
  // "stop working on the Goa hotel search"
  const working = t.match(/^(?:stop|quit)\s+working\s+on\s+(.+)$/i)
  if (working) {
    const target = cleanTarget(working[1])
    return target ? { target, explicit: true } : null
  }
  // "abort the flight booking" (bare "abort mission" is not a named target)
  const abort = t.match(/^abort\s+(.+)$/i)
  if (abort) {
    const target = cleanTarget(abort[1])
    return target ? { target, explicit: true } : null
  }
  // "stop the flight booking" — soft: only claimed when an active run fully matches.
  const soft = t.match(/^(?:stop|halt)\s+(?:the|my)\s+(.+)$/i)
  if (soft) {
    const target = cleanTarget(soft[1])
    return target ? { target, explicit: false } : null
  }
  return null
}

const STOPWORDS = new Set(['the', 'my', 'a', 'an', 'to', 'for', 'of', 'on', 'in', 'at', 'and', 'with', 'from', 'task', 'job', 'mission', 'run', 'that', 'this', 'your', 'me'])

function stem(word: string) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function tokens(text: string) {
  return String(text || '').toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter(word => word && !STOPWORDS.has(word)).map(stem)
}

function runLabel(run: any) {
  return String(run?.title || run?.type || 'Untitled task').replace(/\s+/g, ' ').trim().slice(0, 140)
}

// Number of the phrase's content words found in the run title (and its type).
export function overlapRunTitle(run: any, phrase: string) {
  const want = tokens(phrase)
  if (!want.length) return { matched: 0, total: 0 }
  const have = tokens(`${runLabel(run)} ${String(run?.type || '').replace(/_/g, ' ')}`)
  const matched = want.filter(word => have.some(h => h === word || (word.length >= 4 && h.length >= 4 && (h.startsWith(word) || word.startsWith(h))))).length
  return { matched, total: want.length }
}

// 0..1 share of the phrase's words found in the run title (2 for an exact title).
export function scoreRunTitle(run: any, phrase: string) {
  const { matched, total } = overlapRunTitle(run, phrase)
  if (!total) return 0
  const title = runLabel(run)
  if (title.toLowerCase().replace(/\s+/g, ' ') === String(phrase || '').toLowerCase().replace(/\s+/g, ' ').trim()) return 2
  return matched / total
}

function byRecency(a: any, b: any) {
  const ta = Date.parse(String(a?.updated_at || a?.started_at || '')) || 0
  const tb = Date.parse(String(b?.updated_at || b?.started_at || '')) || 0
  return tb - ta || String(a?.id || '').localeCompare(String(b?.id || ''))
}

// Deterministic: every word of the phrase must appear in the title (so "train search" never picks
// "Goa hotel search"); only the top-scoring runs are returned, most recent first. More than one
// means the phrase is ambiguous and the caller must ask which.
export function matchRunByTitle(runs: any[], phrase: string) {
  const scored = (runs || []).map(run => ({ run, score: scoreRunTitle(run, phrase) })).filter(entry => entry.score >= 1)
  if (!scored.length) return []
  const top = Math.max(...scored.map(entry => entry.score))
  return scored.filter(entry => entry.score === top).map(entry => entry.run).sort(byRecency)
}

function providerName(meta: any) {
  const named = String(meta?.provider_name || meta?.providerName || meta?.provider || meta?.site || '').trim()
  if (named) return named.slice(0, 60)
  for (const raw of [meta?.browser_url, meta?.auth_original_url, meta?.target_url, meta?.url]) {
    try { if (raw) return new URL(String(raw)).hostname.replace(/^www\./, '') } catch {}
  }
  return 'the provider'
}

function possiblySubmitted(run: any, approvals: any[]) {
  const meta = run?.metadata_json || {}
  return meta.secondary_auth?.safeToRetry === false
    || meta.auth_resume?.safeToRetry === false
    || meta.browser_safe_to_retry === false
    || meta.auth_reconciliation_required === true
    || meta.outcome_unknown === true
    || meta.submitted === true
    || approvals.some(row => ['approved', 'executed'].includes(String(row?.status || '')))
}

function statusLabel(status: string) {
  return status === 'waiting_approval' ? 'waiting for your approval' : status === 'paused' ? 'paused' : status === 'queued' ? 'queued' : 'running'
}

export type RunCancelDeps = {
  db?: any
  releaseAuthHandoff?: (telegramId: string, runId: string) => Promise<void>
  now?: () => Date
  surface?: 'whatsapp' | 'web'
}

type RunCancelResult = { runId: string; status: 'completed' | 'paused'; capability: 'orchestrator'; risk: 'low'; text: string; handledBy: 'run-cancel' }

function reply(runId: string, status: 'completed' | 'paused', text: string): RunCancelResult {
  return { runId, status, capability: 'orchestrator', risk: 'low', text, handledBy: 'run-cancel' }
}

export async function tryCancelRunFromChat(owner: { telegramId: string | number }, text: string, deps: RunCancelDeps = {}): Promise<RunCancelResult | null> {
  const intent = parseRunCancel(text)
  if (!intent) return null
  const tg = String(owner?.telegramId ?? '').trim()
  if (!tg) return null
  const db = deps.db || supabaseAdmin
  const now = (deps.now || (() => new Date()))().toISOString()

  const { data, error } = await db.from('agent_runs')
    .select('id,telegram_id,title,type,status,error,summary,metadata_json,updated_at,started_at')
    .eq('telegram_id', tg)
    .in('status', [...CANCELLABLE_RUN_STATUSES])
    .order('updated_at', { ascending: false })
    .limit(25)
  // A failed read never claims the message: other handlers (or the general agent) still get it.
  if (error) {
    console.error('RUN_CANCEL_LIST_FAILED:', String(error.message || error).slice(0, 180))
    return null
  }
  // Owner-bound twice: the query filter and the row itself.
  const active = ((data || []) as any[])
    .filter(run => String(run?.telegram_id ?? tg) === tg && (CANCELLABLE_RUN_STATUSES as readonly string[]).includes(String(run?.status)) && !retiredRunReason(run))
    .sort(byRecency)

  let target: any
  if (!intent.target) {
    if (!active.length) return reply('run-cancel-none', 'completed', 'You have no active tasks to cancel.')
    target = active[0]
  } else {
    const matches = matchRunByTitle(active, intent.target)
    // A named target that matches no active run is not a run cancel ("cancel the buy milk task",
    // "stop working on my resume"): fall through so the reminder/list/general handlers can answer.
    if (!matches.length) return null
    if (!intent.explicit) {
      // Soft "stop the/my X": claim only one unambiguous run sharing two or more content words, so
      // "stop my medicine" or "stop the SIP" never cancels a task whose title merely contains the word.
      if (matches.length !== 1 || overlapRunTitle(matches[0], intent.target).matched < 2) return null
    }
    if (matches.length > 1) {
      const lines = matches.slice(0, 8).map((run, index) => `${index + 1}. ${runLabel(run)} (${statusLabel(String(run.status))})`).join('\n')
      return reply('run-cancel-ambiguous', 'paused', `More than one active task matches ${intent.target}. Which one should I cancel?\n${lines}\n\nSay *cancel the <name> task* with the full name. Nothing was cancelled.`)
    }
    target = matches[0]
  }

  const runId = String(target.id)
  const title = runLabel(target)
  const meta = target.metadata_json || {}

  const { data: approvalRows, error: approvalReadError } = await db.from('agent_approvals')
    .select('id,status')
    .eq('run_id', runId)
    .eq('telegram_id', tg)
    .in('status', ['pending', 'approved', 'executed'])
  if (approvalReadError) {
    console.error('RUN_CANCEL_APPROVAL_READ_FAILED:', String(approvalReadError.message || approvalReadError).slice(0, 180))
    return null
  }
  const approvals = (approvalRows || []) as any[]
  const submitted = possiblySubmitted(target, approvals)

  // agent_runs_status_check has no 'cancelled'; a cancelled run is terminal 'failed' with
  // error 'user_cancelled', which retiredRunReason shows as "Cancelled by you".
  const { data: saved, error: saveError } = await db.from('agent_runs')
    .update({
      status: 'failed',
      error: 'user_cancelled',
      summary: 'Cancelled by you.',
      completed_at: now,
      updated_at: now,
      metadata_json: { ...meta, state: 'closed', closure_reason: 'user_cancelled', cancelled_at: now, cancelled_from: deps.surface || 'chat', cancelled_from_status: target.status },
    })
    .eq('id', runId)
    .eq('telegram_id', tg)
    .in('status', [...CANCELLABLE_RUN_STATUSES])
    .select('id')
    .maybeSingle()
  if (saveError) {
    console.error('RUN_CANCEL_SAVE_FAILED:', String(saveError.message || saveError).slice(0, 180))
    return reply(runId, 'paused', `I couldn't confirm that ${title} was cancelled, and I haven't retried. Ask *what are you working on for me?* to see its current state.`)
  }
  if (!saved) return reply(runId, 'paused', `${title} finished or changed just now, so nothing was cancelled. Ask *what are you working on for me?* to see its current state.`)

  // Terminate the run's unfinished steps too, so no worker or reconcile pass treats the run as live.
  // agent_steps_status_check allows 'cancelled'. A step whose handler is already executing keeps
  // running in that worker, but its completion/failure writes are guarded on status 'running' and
  // the run itself can no longer be moved out of 'failed' by reconcileRun.
  const { error: stepCancelError } = await db.from('agent_steps')
    .update({ status: 'cancelled', error: 'user_cancelled', completed_at: now })
    .eq('run_id', runId)
    .eq('telegram_id', tg)
    .in('status', ['queued', 'running', 'waiting_approval'])
  if (stepCancelError) console.error('RUN_CANCEL_STEPS_FAILED:', stepCancelError.message)

  const pendingIds = approvals.filter(row => row.status === 'pending').map(row => String(row.id))
  let rejectedIds: string[] = []
  if (pendingIds.length) {
    const { data: rejected, error: rejectError } = await db.from('agent_approvals')
      .update({ status: 'rejected', resolved_at: now, resolution_note: 'cancelled_by_user' })
      .eq('run_id', runId)
      .eq('telegram_id', tg)
      .eq('status', 'pending')
      .select('id')
    if (rejectError) console.error('RUN_CANCEL_APPROVAL_REJECT_FAILED:', rejectError.message)
    rejectedIds = ((rejected || []) as any[]).map(row => String(row.id))
  }

  let handoffReleased = false
  if (meta.handoff || meta.secondary_auth || meta.browser_waiting) {
    try {
      const release = deps.releaseAuthHandoff || (async (telegramId: string, id: string) => (await import('./secondary-auth-handoff')).releaseRunAuthHandoff(telegramId, id))
      await release(tg, runId)
      handoffReleased = true
    } catch (releaseError: any) {
      console.error('RUN_CANCEL_HANDOFF_RELEASE_FAILED:', String(releaseError?.message || releaseError).slice(0, 180))
    }
  }

  const { error: activityError } = await db.from('agent_activity').insert({
    telegram_id: tg,
    run_id: runId,
    event_type: 'agent_run_cancelled_by_user',
    message: `Cancelled by you: ${title}`.slice(0, 900),
    metadata_json: { previous_status: target.status, rejected_approval_ids: rejectedIds, handoff_released: handoffReleased, possibly_submitted: submitted, surface: deps.surface || 'chat' },
  })
  if (activityError) console.error('RUN_CANCEL_ACTIVITY_FAILED:', activityError.message)

  const caveat = submitted ? ` I can't undo anything already submitted to ${providerName(meta)}.` : ''
  return reply(runId, 'completed', `Cancelled: ${title}. Nothing further will run for it.${caveat}`)
}
