// "How's the Goa trip going?" / "status of my flight booking task": one task card, read from the
// owner's own agent_runs + agent_steps. A named query that matches no run returns null so routing
// continues. Live flight status, the usage meter, shop orders, reminders, news, calendar,
// email and watchers have their own handlers and are never claimed here.
//
// Precision over recall (19 Oct review): a named ask only matches a run that is still active or
// was touched in the last 24 hours, and only when the phrase names a task ("booking", "research",
// "plan"...) or shares at least two content words with the run title. Personal phrasings ("how is my
// mom doing", "how is my business doing") are never task asks. DB read errors fall through (null).
import { retiredRunReason } from './task-lifecycle'
import { isAutonomyStatus, isFullTaskList, normalizeStatusAsk } from './attention-state'

/** `full` = "show all tasks": the whole list instead of the short digest. */
export type TaskStatusQuery = { kind: 'all'; full?: true } | { kind: 'named'; phrase: string }
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
// Orders, refunds and shops always belong to commerce handlers, even with "task"/"request".
const ALWAYS_BLOCKS = [PHRASE_BLOCKS[0], PHRASE_BLOCKS[1], PHRASE_BLOCKS[3], PHRASE_BLOCKS[4], ...PHRASE_BLOCKS.slice(-2)]
// "request" alone does not make a named task: leave/refund/order requests are someone else's.
const DOMAIN_BYPASS = /\b(?:task|tasks|run|job|mission)\b/
// "how is my mom doing" / "how is my business going" are about life, not a task card.
const PERSONAL_SUBJECT = /^(?:(?:dear|dearest|little|baby|old|new)\s+)?(?:mom|mum|mommy|mummy|mother|amma|dad|daddy|father|papa|appa|parents?|wife|husband|hubby|spouse|partner|girlfriend|boyfriend|fiance|fiancee|son|daughter|kids?|children|child|baby|family|brother|sister|bro|sis|siblings?|grandma|grandpa|granny|grandmother|grandfather|aunt|uncle|cousin|friends?|dog|cat|pet|business|company|startup|firm|shop|store|restaurant|team|staff|career|job|work|office|relationship|marriage|love life|health|body|knee|back|diet|fitness|studies|exams?|college|school|garden|plants?|car|bike|house|home)$/
const BARE_TRANSPORT = /\b(?:flights?|trains?|bus|buses|cabs?|rides?)\b/
const TRANSPORT_TASK = /\b(?:booking|bookings|search|research|task|job|hunt|deals?|fares?|prices?|plan|planning|mission|request)\b/

function cleanPhrase(raw: string) {
  return raw.replace(/\s+(?:for me|so far|now|yet|right now)$/, '').replace(/^(?:all\s+)?/, '').trim()
}

/** null = not a task-status ask. */
export function parseTaskStatusQuery(text: string): TaskStatusQuery | null {
  const t = norm(text)
  if (!t || t.length > 120) return null
  if (isFullTaskList(text)) return { kind: 'all', full: true }
  if (isAutonomyStatus(text)) return { kind: 'all' }
  for (const re of NAMED_PATTERNS) {
    const m = t.match(re)
    if (!m?.[1]) continue
    const phrase = cleanPhrase(m[1])
    if (/^(?:background\s+)?(?:tasks|runs|jobs|work)$/.test(phrase)) return { kind: 'all' }
    const words = phrase.split(' ').filter(Boolean)
    if (!words.length || words.length > 6 || phrase.length < 3) return null
    // Domain words ("calendar", "reminder", "watch"…) belong to their own handlers unless the
    // ask explicitly names a task ("the Jailer 2 calendar task", 19 Oct live). Flight
    // identifiers, compound requests and action verbs always stay out.
    const blocks = DOMAIN_BYPASS.test(phrase) ? ALWAYS_BLOCKS : PHRASE_BLOCKS
    if (blocks.some(block => block.test(phrase))) return null
    if (PERSONAL_SUBJECT.test(phrase)) return null
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
// Runs a named ask may match regardless of age. Anything else must have been updated recently.
const MATCHABLE_STATUSES = ['queued', 'running', 'waiting_approval', 'paused', 'watching']
const MATCHABLE = new Set(MATCHABLE_STATUSES)
const RECENT_MATCH_HOURS = 24
// An explicit task word in the ask is enough on its own; otherwise two content words must overlap.
const EXPLICIT_TASK_WORD = /\b(?:tasks?|bookings?|research(?:es|ing)?|search(?:es|ing)?|orders?|plans?|planning|jobs?|requests?)\b/

/** A run a named ask may match: still active, or updated within the last 24 hours. */
export function isMatchableRun(run: any, now: Date = new Date()) {
  if (MATCHABLE.has(String(run?.status))) return true
  const at = Date.parse(String(run?.updated_at || ''))
  return Number.isFinite(at) && now.getTime() - at <= RECENT_MATCH_HOURS * 3600000
}

/**
 * Deterministic title match: every content word of the phrase must appear in the run title, the ask
 * must name a task or share >= 2 content words with the title, and the run must be matchable.
 */
export function matchRunByTitle(runs: any[], phrase: string, now: Date = new Date()): { run: any; others: number } | null {
  const wanted = [...new Set(contentTokens(phrase))]
  if (!wanted.length) return null
  if (!EXPLICIT_TASK_WORD.test(String(phrase || '').toLowerCase()) && wanted.length < 2) return null
  const hits = (runs || []).filter(run => {
    if (!isMatchableRun(run, now)) return false
    const have = new Set(tokens(run?.title))
    return wanted.every(w => have.has(w))
  })
  if (!hits.length) return null
  const rank = (run: any) => (ACTIVE.has(String(run.status)) && !retiredRunReason(run) ? 1 : 0)
  const time = (run: any) => Date.parse(String(run.updated_at || '')) || 0
  const sorted = [...hits].sort((a, b) => rank(b) - rank(a) || time(b) - time(a))
  return { run: sorted[0], others: sorted.length - 1 }
}

/** Up to 3 matchable runs sharing a content word with the phrase: most overlap, then most recent. */
export function closestRuns(runs: any[], phrase: string, now: Date = new Date(), limit = 3) {
  const wanted = new Set(contentTokens(phrase))
  if (!wanted.size) return []
  const time = (run: any) => Date.parse(String(run.updated_at || '')) || 0
  return (runs || [])
    .filter(run => isMatchableRun(run, now) && !retiredRunReason(run))
    .map(run => ({ run, score: new Set(tokens(run?.title).filter(w => wanted.has(w))).size }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || time(b.run) - time(a.run))
    .slice(0, limit).map(entry => entry.run)
}

function notFoundText(phrase: string, close: any[]) {
  const label = clean(phrase.replace(/\b(?:task|tasks|run|runs|job|jobs|mission)\b/g, ' '), 60) || clean(phrase, 60)
  const names = close.map(run => `*${clean(run.title, 60) || 'Untitled task'}*`)
  if (!names.length) return `I couldn't find a "${label}" task. Reply *show all tasks* to see what I'm working on.`
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
  return `I couldn't find a "${label}" task. Did you mean ${list}?`
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

/** Whether a run is stopped on a human-only sign-in or one-time-code step. */
export function runAuthReason(run: any, steps: any[] = []): 'otp' | 'sign_in' | null {
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
  const auth = ['paused', 'failed', 'running'].includes(status) ? runAuthReason(run, ordered) : null
  const approvalStep = ordered.find(step => step.status === 'waiting_approval')
  const waitingApproval = status === 'waiting_approval' || (Boolean(approvalStep) && ACTIVE.has(status))

  // One short paragraph (Fo-style, 19 Oct): what state it is in, the key facts, what happens next.
  let stage: string
  if (retired) stage = `is closed (${retired.toLowerCase()})`
  else if (waitingApproval) stage = 'is waiting for your approval'
  else if (status === 'running') stage = 'is running'
  else if (status === 'queued') stage = "is queued and hasn't started yet"
  else if (status === 'paused') stage = auth === 'otp' ? 'is paused until you enter a one-time code' : auth ? 'is paused until you sign in' : 'is paused and not running'
  else if (status === 'outcome_unknown') stage = 'has an unconfirmed outcome'
  else if (status === 'completed') stage = 'is done'
  else if (status === 'failed') stage = auth ? 'stopped at a sign-in step' : 'failed'
  else if (status === 'cancelled') stage = 'was cancelled'
  else if (status === 'blocked') stage = 'is blocked'
  else stage = `has a status I don't recognise (${clean(status, 40).replaceAll('_', ' ')})`

  const active = !retired && ACTIVE.has(status)
  const current = ordered.find(step => ['running', 'waiting_approval'].includes(step.status)) || ordered.find(step => step.status === 'queued')
  const currentTitle = current ? clean(current.title, 90) : ''
  const activityText = clean(lastActivity?.text, 140)
  const ago = lastActivity?.at ? relativeTime(lastActivity.at, now) : ''
  // The latest activity is folded into the step when it is that step starting.
  const activityIsCurrentStart = Boolean(currentTitle) && activityText === `Started: ${currentTitle}`
  let detail = ''
  if (ordered.length && current && active) detail = ` — step ${ordered.indexOf(current) + 1} of ${ordered.length} (${currentTitle}${activityIsCurrentStart && ago ? `, started ${ago}` : ''})`
  const progress = Number(run?.progress)
  if (run?.progress !== null && run?.progress !== undefined && Number.isFinite(progress)) detail += `, ${Math.max(0, Math.min(100, Math.round(progress)))}% done`

  // With no step events, lastRunActivity falls back to the run summary: show only when it changed.
  const activityIsRunFallback = !ordered.some(step => step.started_at || step.completed_at)
  if (activityIsRunFallback && ago && !activityIsCurrentStart) detail += ` (updated ${ago})`
  const sentences = [`*${clean(run?.title, 120) || 'Untitled task'}* ${stage}${detail}.`]
  const summary = sentence(clip(run?.summary, 200))
  if (summary) sentences.push(summary)
  if (activityText && !activityIsCurrentStart && !activityIsRunFallback) {
    const text = activityText.replace(/^(Started|Finished|Failed|Cancelled): /, (_m, verb: string) => `${verb.toLowerCase()} `)
    sentences.push(sentence(`Last update${ago ? ` ${ago}` : ''}: ${text}`))
  }

  const stale = (status === 'running' || status === 'queued') && Boolean(lastActivity?.at) && now.getTime() - (Date.parse(String(lastActivity?.at)) || now.getTime()) > STALE_HOURS * 3600000
  let next: string | null = null
  // An unconfirmed outcome is always flagged, even on a closed run: never imply it went through.
  if (status === 'outcome_unknown') next = 'I could not confirm whether it went through. Please check with the provider before retrying, so nothing happens twice.'
  else if (!retired) {
    if (waitingApproval) next = 'Nothing consequential happens until you approve or reject it.'
    else if (auth === 'otp' && status !== 'completed') next = "Only you can enter the one-time code (OTP) on the secure sign-in screen; please don't send it in chat."
    else if (auth && status !== 'completed') next = "Please sign in on the provider's site to continue; I won't sign in for you."
    else if (stale) next = `No activity for over ${STALE_HOURS} hours, so I can't confirm it is still progressing.`
    else if (status === 'running' || status === 'queued') next = 'Nothing needed from you right now.'
    else if (status === 'paused') next = 'It is not running in the background; say continue or cancel.'
    else if (status === 'completed') next = 'Nothing left pending on my side.'
    else if (status === 'failed') next = 'It did not finish, and nothing further is running for it.'
  }
  if (next) sentences.push(next)
  return sentences.join(' ')
}

/** Trim to max chars on a word boundary, with an ellipsis when cut. */
function clip(value: unknown, max: number) {
  const text = clean(value, 2000)
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/, '')}…`
}
function sentence(text: string) {
  const t = String(text || '').trim()
  return !t || /[.!?…)]$/.test(t) ? t : `${t}.`
}

async function defaultDeps(): Promise<TaskStatusDeps> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  return {
    async listRuns(telegramId) {
      // Only candidates a named ask may match: active, or touched within the recency window.
      const cutoff = new Date(Date.now() - RECENT_MATCH_HOURS * 3600000).toISOString()
      const { data, error } = await supabaseAdmin.from('agent_runs')
        .select('id,telegram_id,status,title,summary,progress,updated_at,error,metadata_json')
        .eq('telegram_id', telegramId)
        .or(`status.in.(${MATCHABLE_STATUSES.join(',')}),updated_at.gte.${cutoff}`)
        .order('updated_at', { ascending: false }).limit(50)
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
  let d: TaskStatusDeps
  let runs: any[]
  try {
    d = deps || await defaultDeps()
    runs = ((await d.listRuns(tg)) || []).filter(run => run && String(run.telegram_id ?? tg) === tg)
  } catch (err: any) {
    // A failed read is not "no such task" — but it must not break routing either: fall through.
    console.error('TASK_STATUS_READ_FAILED:', clean(err?.message || err, 200))
    return null
  }
  const now = d.now ? d.now() : new Date()
  const match = matchRunByTitle(runs, query.phrase, now)
  if (!match) {
    // Only an ask that explicitly names a task ("any update on the Kerala trip task?") is answered
    // with "not found"; anything else falls through so its own handler can still claim it.
    if (!DOMAIN_BYPASS.test(query.phrase)) return null
    return {
      runId: 'task-status-not-found',
      status: 'completed' as const,
      capability: 'orchestrator' as const,
      risk: 'low' as const,
      text: notFoundText(query.phrase, closestRuns(runs, query.phrase, now)),
      handledBy: 'task-status',
      readOnly: true,
      mutated: false,
    }
  }
  let steps: any[]
  try {
    steps = ((await d.listSteps(tg, String(match.run.id))) || [])
      .filter(step => String(step.telegram_id ?? tg) === tg && String(step.run_id ?? match.run.id) === String(match.run.id))
  } catch (err: any) {
    console.error('TASK_STATUS_READ_FAILED:', clean(err?.message || err, 200))
    return null
  }
  const card = formatRunStatus(match.run, steps, lastRunActivity(match.run, steps), now)
  const more = match.others ? `\n\n${match.others} other task${match.others === 1 ? ' also matches' : 's also match'} "${clean(query.phrase, 60)}". Reply *show all tasks* to see them.` : ''
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
