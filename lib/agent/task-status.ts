// "How's the Goa trip going?" / "status of my flight booking task": one task card, read from the
// owner's own agent_runs + agent_steps. A named query that matches no run returns null so routing
// continues. Live flight status, the usage meter, shop orders, reminders, news, calendar,
// email and watchers have their own handlers and are never claimed here.
import { retiredRunReason } from './task-lifecycle'
import { isAutonomyStatus, normalizeStatusAsk } from './attention-state'

export type TaskStatusQuery = { kind: 'all' } | { kind: 'named'; phrase: string }
export type TaskStatusOwner = { telegramId: string | number }
export type TaskRunActivity = { at: string; text: string } | null
export type TaskStatusDeps = {
  listRuns: (telegramId: string) => Promise<any[]>
  listSteps: (telegramId: string, runId: string) => Promise<any[]>
  now?: () => Date
}

const norm = normalizeStatusAsk
const WHAT = "what(?:'s|s| is)"

const DET = '(?:my|the|our)'
const NAMED_PATTERNS = [
  new RegExp(`^how(?:'s|s| is| are)\\s+${DET}\\s+(.+?)\\s+(?:going|coming along|progressing|doing|looking)(?:\\s+(?:so far|now))?$`),
  new RegExp(`^${WHAT}\\s+(?:happening|going on|the latest)\\s+(?:with|on)\\s+${DET}\\s+(.+)$`),
  new RegExp(`^(?:${WHAT}\\s+the\\s+)?(?:status|progress)\\s+(?:of|on|for|with)\\s+${DET}\\s+(.+)$`),
  new RegExp(`^(?:any\\s+)?(?:updates?|progress)\\s+(?:on|about|with|for)\\s+${DET}\\s+(.+)$`),
  new RegExp(`^where\\s+(?:are\\s+we|are\\s+you|am\\s+i)\\s+(?:on|with)\\s+${DET}\\s+(.+)$`),
  new RegExp(`^(?:is|has)\\s+${DET}\\s+(.+?\\s+(?:task|run|job|mission))\\s+(?:done|finished|complete|completed|running|working)(?:\\s+yet)?$`),
  /^(?:my\s+)?(.+?\s+(?:task|run|job|mission))\s+status$/,
]

const TASK_NOUN = /\b(?:task|tasks|run|job|mission|request)\b/
// Each of these has its own deterministic owner elsewhere (see file header).
const PHRASE_BLOCKS = [
  /\b(?:[a-z]{2}|[a-z]\d|\d[a-z])\s?-?\d{1,4}\b/, // flight identifiers: 6E123, AI 505, EY1
  /\b(?:flight|train|bus)\s+status\b|\bpnr\b/,
  /\b(?:usage|credits?|quota|meter|subscriptions?|billing|plan usage)\b/,
  /\b(?:orders?|deliver(?:y|ies)|parcels?|packages?|shipments?|courier|refunds?)\b/,
  /\b(?:amazon|flipkart|swiggy|zomato|blinkit|zepto|myntra|instamart|bigbasket|nykaa|ajio)\b/,
  /\b(?:reminders?|alarms?)\b/,
  /\b(?:news|weather|stocks?|market|score|match)\b/,
  /\b(?:calendar|meetings?|events?|schedule|agenda)\b/,
  /\b(?:emails?|mail|inbox|gmail)\b/,
  /\b(?:watch(?:es|er|ers)?|monitors?|alerts?)\b/,
  /\b(?:goals?|accounts?|connections?)\b/,
  /\b(?:day|week|weekend|month|today|tomorrow|morning|evening|life|health|mood)\b/,
  /\b(?:portfolio|investments?|funds?|sips?|spend(?:ing)?|expenses?|budget)\b/,
  // compound or action requests are not status reads
  /\b(?:and|then|also)\b|[,;]/,
  /\b(?:cancel|stop|book|approve|reject|retry|resume|restart|change|move|delete|add|create|start)\b/,
]
const BARE_TRANSPORT = /\b(?:flights?|trains?|bus|buses|cabs?|rides?)\b/
const TRANSPORT_TASK = /\b(?:booking|bookings|search|research|task|job|hunt|deals?|fares?|prices?|plan|planning|mission|request)\b/

function cleanPhrase(raw: string) {
  return raw.replace(/\s+(?:for me|so far|now|yet|right now)$/, '').replace(/^(?:all\s+)?/, '').trim()
}

/** null = not a task-status ask. */
export function parseTaskStatusQuery(text: string): TaskStatusQuery | null {
  const t = norm(text)
  if (!t || t.length > 120) return null
  if (isAutonomyStatus(text)) return { kind: 'all' }
  for (const re of NAMED_PATTERNS) {
    const m = t.match(re)
    if (!m?.[1]) continue
    const phrase = cleanPhrase(m[1])
    if (/^(?:background\s+)?(?:tasks|runs|jobs|work)$/.test(phrase)) return { kind: 'all' }
    const words = phrase.split(' ').filter(Boolean)
    if (!words.length || words.length > 6 || phrase.length < 3) return null
    if (PHRASE_BLOCKS.some(block => block.test(phrase))) return null
    if (BARE_TRANSPORT.test(phrase) && !TRANSPORT_TASK.test(phrase)) return null
    const content = contentTokens(phrase)
    if (!content.length) return null
    return { kind: 'named', phrase }
  }
  return null
}

const STOP = new Set(['my', 'the', 'our', 'a', 'an', 'for', 'to', 'of', 'on', 'with', 'task', 'tasks', 'run', 'runs', 'job', 'jobs', 'mission', 'request', 'thing', 'stuff', 'that', 'this'])
function stem(word: string) {
  let w = word
  if (w.length > 5 && w.endsWith('ings')) w = w.slice(0, -4)
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  return w
}
function tokens(text: string) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem)
}
function contentTokens(phrase: string) {
  return tokens(phrase).filter(w => !STOP.has(w) && w.length > 1)
}

const ACTIVE = new Set(['queued', 'running', 'waiting_approval', 'paused', 'outcome_unknown'])

/** Deterministic title match: every content word of the phrase must appear in the run title. */
export function matchRunByTitle(runs: any[], phrase: string): { run: any; others: number } | null {
  const wanted = contentTokens(phrase)
  if (!wanted.length) return null
  const hits = (runs || []).filter(run => {
    const have = new Set(tokens(run?.title))
    return wanted.every(w => have.has(w))
  })
  if (!hits.length) return null
  const rank = (run: any) => (ACTIVE.has(String(run.status)) && !retiredRunReason(run) ? 1 : 0)
  const time = (run: any) => Date.parse(String(run.updated_at || '')) || 0
  const sorted = [...hits].sort((a, b) => rank(b) - rank(a) || time(b) - time(a))
  return { run: sorted[0], others: sorted.length - 1 }
}

function clean(value: unknown, max = 220) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }

export function relativeTime(iso: string | null | undefined, now: Date) {
  const at = Date.parse(String(iso || ''))
  if (!Number.isFinite(at)) return ''
  const minutes = Math.round((now.getTime() - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Most recent thing that happened on the run, from its steps, else the run itself. */
export function lastRunActivity(run: any, steps: any[]): TaskRunActivity {
  const events: Array<{ at: string; text: string }> = []
  for (const step of steps || []) {
    const title = clean(step.title, 140)
    if (step.completed_at) events.push({ at: String(step.completed_at), text: `${step.status === 'failed' ? 'Failed' : step.status === 'cancelled' ? 'Cancelled' : 'Finished'}: ${title}` })
    else if (step.started_at) events.push({ at: String(step.started_at), text: `Started: ${title}` })
  }
  events.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
  if (events[0]) return events[0]
  if (run?.updated_at) return { at: String(run.updated_at), text: clean(run.summary, 180) || 'Task updated' }
  return null
}

function authReason(run: any, steps: any[]): 'otp' | 'sign_in' | null {
  const meta = run?.metadata_json || run?.metadata || {}
  const stepAuth = (steps || []).find(step => String(step.error || '') === 'human_auth_required')
  const reason = String(meta.secondary_auth?.reason || stepAuth?.output_json?.authReason || '')
  if (reason === 'otp') return 'otp'
  if (meta.secondary_auth || meta.auth_resume || meta.handoff?.takeoverUrl || (meta.handoff?.mode === 'device' && meta.handoff?.providerUrl)
    || stepAuth || String(run?.error || '') === 'human_auth_required') return 'sign_in'
  return null
}

const STALE_HOURS = 24

/** One task card in plain words. Pure: all inputs are passed in. */
export function formatRunStatus(run: any, steps: any[], lastActivity: TaskRunActivity, now: Date) {
  const status = String(run?.status || 'unknown')
  const ordered = [...(steps || [])].sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0))
  const retired = retiredRunReason(run)
  const auth = ['paused', 'failed', 'running'].includes(status) ? authReason(run, ordered) : null
  const approvalStep = ordered.find(step => step.status === 'waiting_approval')
  const waitingApproval = status === 'waiting_approval' || (Boolean(approvalStep) && ACTIVE.has(status))

  let stage: string
  if (retired) stage = `Closed — ${retired.toLowerCase()}`
  else if (waitingApproval) stage = 'Waiting for your approval'
  else if (status === 'running') stage = 'Running now'
  else if (status === 'queued') stage = 'Queued — not started yet'
  else if (status === 'paused') stage = auth === 'otp' ? 'Paused — needs a one-time code from you' : auth ? 'Paused — needs you to sign in' : 'Paused — not running'
  else if (status === 'outcome_unknown') stage = 'Outcome unknown'
  else if (status === 'completed') stage = 'Completed'
  else if (status === 'failed') stage = auth ? 'Stopped at a sign-in step' : 'Failed'
  else if (status === 'cancelled') stage = 'Cancelled'
  else if (status === 'blocked') stage = 'Blocked'
  else stage = `Status not recognised (${clean(status, 40).replaceAll('_', ' ')})`

  const lines = [`📋 *${clean(run?.title, 150) || 'Untitled task'}*`, `Status: ${stage}`]
  const current = ordered.find(step => ['running', 'waiting_approval'].includes(step.status)) || ordered.find(step => step.status === 'queued')
  if (ordered.length && current && !retired && ACTIVE.has(status)) lines.push(`Step ${ordered.indexOf(current) + 1} of ${ordered.length}: ${clean(current.title, 140)}`)
  const progress = Number(run?.progress)
  if (run?.progress !== null && run?.progress !== undefined && Number.isFinite(progress)) lines.push(`Progress: ${Math.max(0, Math.min(100, Math.round(progress)))}%`)
  const summary = clean(run?.summary, 220)
  if (summary) lines.push(summary)
  if (lastActivity?.at) {
    const ago = relativeTime(lastActivity.at, now)
    lines.push(`Last activity: ${clean(lastActivity.text, 180)}${ago ? ` (${ago})` : ''}`)
  }

  let waitingOn: string | null = null
  if (!retired) {
    if (waitingApproval) waitingOn = 'your approval. Nothing consequential happens until you approve or reject it.'
    else if (auth === 'otp' && status !== 'completed') waitingOn = 'a one-time code (OTP) that only you can enter on the secure sign-in screen. Please don\'t send the code in chat.'
    else if (auth && status !== 'completed') waitingOn = 'your sign-in on the provider\'s site. I won\'t sign in for you.'
    else if (status === 'running' || status === 'queued') waitingOn = 'nothing from you right now.'
    else if (status === 'paused') waitingOn = 'you to say whether to continue. It is not running in the background.'
  }
  if (waitingOn) lines.push(`Waiting on: ${waitingOn}`)

  if (status === 'outcome_unknown') lines.push('I could not confirm whether this went through. Please check with the provider before retrying, so nothing is done twice.')
  else if ((status === 'running' || status === 'queued') && lastActivity?.at && now.getTime() - (Date.parse(lastActivity.at) || now.getTime()) > STALE_HOURS * 3600000)
    lines.push(`No activity for over ${STALE_HOURS} hours, so I can't confirm it is still progressing.`)
  else if (status === 'failed' && !auth) lines.push('It did not finish. Nothing further is running for it.')

  return lines.join('\n')
}

async function defaultDeps(): Promise<TaskStatusDeps> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  return {
    async listRuns(telegramId) {
      const { data, error } = await supabaseAdmin.from('agent_runs')
        .select('id,telegram_id,status,title,summary,progress,updated_at,error,metadata_json')
        .eq('telegram_id', telegramId).order('updated_at', { ascending: false }).limit(50)
      if (error) throw new Error(`task_status_runs_read_failed:${error.message}`)
      return data || []
    },
    async listSteps(telegramId, runId) {
      const { data, error } = await supabaseAdmin.from('agent_steps')
        .select('id,telegram_id,run_id,ordinal,title,status,error,output_json,started_at,completed_at')
        .eq('telegram_id', telegramId).eq('run_id', runId).order('ordinal', { ascending: true }).limit(100)
      if (error) throw new Error(`task_status_steps_read_failed:${error.message}`)
      return data || []
    },
  }
}

/** Named task status. Returns null for general asks (autonomy-status owns those) and when no run matches. */
export async function tryGetTaskStatus(owner: TaskStatusOwner, text: string, deps?: TaskStatusDeps) {
  const query = parseTaskStatusQuery(text)
  if (!query || query.kind !== 'named') return null
  const tg = String(owner?.telegramId ?? '').trim()
  if (!tg || tg === '0' || tg === 'undefined' || tg === 'null') throw new Error('task_status_owner_missing')
  const d = deps || await defaultDeps()
  const runs = (await d.listRuns(tg)).filter(run => run && String(run.telegram_id ?? tg) === tg)
  const match = matchRunByTitle(runs, query.phrase)
  if (!match) return null
  const steps = (await d.listSteps(tg, String(match.run.id)))
    .filter(step => String(step.telegram_id ?? tg) === tg && String(step.run_id ?? match.run.id) === String(match.run.id))
  const now = d.now ? d.now() : new Date()
  const card = formatRunStatus(match.run, steps, lastRunActivity(match.run, steps), now)
  const more = match.others ? `\n\n${match.others} other task${match.others === 1 ? '' : 's'} also match "${clean(query.phrase, 60)}". Say *what are you working on* to see them all.` : ''
  return {
    runId: String(match.run.id),
    status: 'completed' as const,
    capability: 'orchestrator' as const,
    risk: 'low' as const,
    text: `${card}${more}`,
    handledBy: 'task-status',
    readOnly: true,
    mutated: false,
  }
}
