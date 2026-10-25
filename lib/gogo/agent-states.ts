// The Gogo character system (docs/design/gogo-character): every action Gogo takes has its own character state,
// like Muse. This file is the single place that decides which state a task, approval or watch shows, and the
// short live line under Gogo. Pure functions only, so the server pages and the client panel agree.

export const GOGO_AGENT_STATES = [
  'idle', 'thinking', 'searching', 'browsing', 'comparing', 'flight', 'train', 'grocery',
  'booking', 'approval', 'otp', 'watcher', 'done', 'blocked', 'failed',
] as const
export type GogoAgentState = (typeof GOGO_AGENT_STATES)[number]

export const GOGO_STATE_NAME: Record<GogoAgentState, string> = {
  idle: 'Idle', thinking: 'Thinking / planning', searching: 'Searching the web', browsing: 'Deep browser work',
  comparing: 'Comparing options', flight: 'Flight search', train: 'Train / IRCTC search', grocery: 'Grocery / food search',
  booking: 'Booking / preparing', approval: 'Waiting for approval', otp: 'Waiting for OTP / login', watcher: 'Background watcher',
  done: 'Completed', blocked: 'Needs you to continue', failed: 'Trying another way',
}

// Live lines never claim more than the task state proves: "done" is "Finished", never "Booked".
export const GOGO_STATE_LINE: Record<GogoAgentState, string> = {
  idle: 'Ready when you are',
  thinking: 'Planning the next steps…',
  searching: 'Searching live sources…',
  browsing: 'Working in the browser…',
  comparing: 'Comparing options…',
  flight: 'Checking current fares…',
  train: 'Checking seat availability…',
  grocery: 'Building your cart…',
  booking: 'Preparing your booking…',
  approval: 'Waiting for your approval…',
  otp: 'Continue on your phone — I will pick up from here',
  watcher: 'Watching in the background',
  done: 'Finished',
  blocked: 'This site needs you to continue',
  failed: 'That route did not work',
}

export type RunLike = {
  type?: string | null
  capability?: string | null
  title?: string | null
  summary?: string | null
  status?: string | null
  error?: string | null
  metadata?: any
  metadata_json?: any
}

const OTP_RE = /\b(otp|one[-\s]?time|verification code|sms code|enter the code|code sent)\b/i
const LOGIN_RE = /\b(sign[-\s]?in|log[-\s]?in|login|captcha|robot check|take control|handoff|password)\b/i

/** What Gogo is doing, from the words of the task (used while it is running). */
export function topicState(text: string, run: RunLike = {}): GogoAgentState {
  const t = String(text || '').toLowerCase()
  const type = String(run.type || '').toLowerCase()
  if (/flight|airline|indigo|air india|akasa|vistara|fare|boarding pass|check-?in/.test(t) || type === 'travel_ticket' || type === 'travel_research') return 'flight'
  if (/\btrain|irctc|tatkal|pnr\b|railway/.test(t) || type === 'train_research') return 'train'
  if (/table for|reserv|dineout|book a table|appointment/.test(t) || type === 'restaurant_reservation_release' || type === 'appointment_research') return 'booking'
  if (/grocer|instamart|blinkit|zepto|bigbasket|swiggy|zomato|food order|\bcart\b/.test(t)) return 'grocery'
  if (/compar|price|cheapest|best deal|vs\.?\s|discount/.test(t) || type === 'product_stock') return 'comparing'
  if (/\bbook|reserv|table for|appointment|slot\b|tickets? for/.test(t) || type === 'restaurant_reservation_release' || type === 'appointment_research') return 'booking'
  if (type === 'secure_browser' || run.capability === 'browser' || /browser|website|page/.test(t)) return 'browsing'
  if (/search|research|find|look ?up|news/.test(t) || type === 'web_search') return 'searching'
  return 'thinking'
}

/** The state a task shows, from its status first and its topic second. */
export function stateForRun(run: RunLike): GogoAgentState {
  const status = String(run.status || '')
  const text = `${run.title || ''} ${run.summary || ''}`
  const reason = `${run.error || ''} ${text} ${JSON.stringify(run.metadata || run.metadata_json || {})}`
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'waiting_approval') return 'approval'
  if (status === 'paused') return OTP_RE.test(reason) ? 'otp' : LOGIN_RE.test(reason) ? 'blocked' : 'blocked'
  if (status === 'running' || status === 'queued') return topicState(text, run)
  if (status === 'closed') return 'idle'
  return topicState(text, run)
}

/** A stop the user has to clear on a site (Take control / sign-in). */
export function stateForHandoff(h: { title?: string | null; summary?: string | null }): GogoAgentState {
  return OTP_RE.test(`${h.title || ''} ${h.summary || ''}`) ? 'otp' : 'blocked'
}

/** The live line for a run: its own summary when short and readable, else the state's line. */
export function liveLineFor(state: GogoAgentState, summary?: string | null): string {
  const s = String(summary || '').replace(/\s+/g, ' ').trim()
  if (s && s.length <= 90 && (state === 'thinking' || state === 'searching' || state === 'browsing' || state === 'comparing' || state === 'flight' || state === 'train' || state === 'grocery' || state === 'booking')) return s
  return GOGO_STATE_LINE[state]
}

/** The one state the whole dashboard shows for Gogo right now. */
export function overallState(input: { working: RunLike[]; approvals: number; handoffs: number; watchers: number }): GogoAgentState {
  if (input.working.length) return stateForRun(input.working[0])
  if (input.approvals) return 'approval'
  if (input.handoffs) return 'blocked'
  if (input.watchers) return 'watcher'
  return 'idle'
}
