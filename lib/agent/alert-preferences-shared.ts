// Shared (client-safe) part of alert preferences. Duet parity step 2 (approved 22 Oct mock): what each person hears about and how often — check frequency,
// topics and quiet hours. One row per owner (user_alert_preferences); a missing row or table means defaults, so
// code deploys safely before the migration. Approvals the person is waiting on are never muted by topic.

export const ALERT_TOPICS = ['bills', 'replies', 'calendar', 'watches', 'travel', 'tasks', 'ideas'] as const
export type AlertTopic = typeof ALERT_TOPICS[number]
export const CHECK_EVERY_OPTIONS = [60, 120, 240, 480] as const
export type AlertPreferences = {
  checkEveryMinutes: number
  topics: Record<AlertTopic, boolean>
  quietStart: number
  quietEnd: number
  saved: boolean
}

export const TOPIC_LABEL: Record<AlertTopic, { label: string; sub: string }> = {
  bills: { label: 'Bills and payment reminders', sub: 'Service and payment notices from your email' },
  replies: { label: 'Replies and follow-ups', sub: 'People you are waiting on' },
  calendar: { label: 'Calendar changes and clashes', sub: 'Your connected calendars' },
  watches: { label: 'Price and fare drops', sub: 'Your watches' },
  travel: { label: 'Travel: check-in, delays, gate changes', sub: 'Saved tickets and trips' },
  tasks: { label: 'Tasks that hit a blocker', sub: 'When Gogo is stuck and needs you' },
  ideas: { label: 'Suggestions', sub: 'Only strong ideas Gogo thinks are worth it' },
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  checkEveryMinutes: 60,
  topics: Object.fromEntries(ALERT_TOPICS.map(t => [t, true])) as Record<AlertTopic, boolean>,
  quietStart: 22,
  quietEnd: 7,
  saved: false,
}

function hour(v: unknown, fallback: number) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback
}

/** Normalise a stored row or a request body. Unknown topics are dropped; missing ones stay on. */
export function normaliseAlertPreferences(raw: any, saved = false): AlertPreferences {
  const r = raw && typeof raw === 'object' ? raw : {}
  const every = Number(r.checkEveryMinutes ?? r.check_every_minutes)
  const topicsIn = r.topics && typeof r.topics === 'object' ? r.topics : {}
  return {
    checkEveryMinutes: (CHECK_EVERY_OPTIONS as readonly number[]).includes(every) ? every : DEFAULT_ALERT_PREFERENCES.checkEveryMinutes,
    topics: Object.fromEntries(ALERT_TOPICS.map(t => [t, topicsIn[t] === undefined ? true : topicsIn[t] === true])) as Record<AlertTopic, boolean>,
    quietStart: hour(r.quietStart ?? r.quiet_start, DEFAULT_ALERT_PREFERENCES.quietStart),
    quietEnd: hour(r.quietEnd ?? r.quiet_end, DEFAULT_ALERT_PREFERENCES.quietEnd),
    saved,
  }
}

/** Strict request validation: reject anything outside the offered choices rather than guessing. */
export function parseAlertPreferencesBody(raw: unknown): AlertPreferences | null {
  const r: any = raw && typeof raw === 'object' ? raw : null
  if (!r) return null
  if (!(CHECK_EVERY_OPTIONS as readonly number[]).includes(Number(r.checkEveryMinutes))) return null
  for (const k of ['quietStart', 'quietEnd']) { const n = Number(r[k]); if (!Number.isInteger(n) || n < 0 || n > 23) return null }
  if (!r.topics || typeof r.topics !== 'object') return null
  for (const [k, v] of Object.entries(r.topics)) if (!(ALERT_TOPICS as readonly string[]).includes(k) || typeof v !== 'boolean') return null
  return normaliseAlertPreferences(r, true)
}

/** Quiet window in the person's own timezone; start > end wraps past midnight (22 → 7). Equal = never quiet. */
export function isQuietHour(prefs: Pick<AlertPreferences, 'quietStart' | 'quietEnd'>, localHour: number): boolean {
  const { quietStart: s, quietEnd: e } = prefs
  if (s === e) return false
  return s < e ? localHour >= s && localHour < e : localHour >= s || localHour < e
}

/** Has enough time passed since the last proactive message for this person's chosen frequency? */
export function dueForCheck(prefs: Pick<AlertPreferences, 'checkEveryMinutes'>, lastSentAt: string | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(String(lastSentAt || ''))
  return !Number.isFinite(at) || now - at >= prefs.checkEveryMinutes * 60_000 - 5 * 60_000
}

/** Which topic a proactive item belongs to. Approvals return null: never muted. */
export function topicForPulse(kind: string, loop?: { kind?: string | null; source_type?: string | null } | null): AlertTopic | null {
  if (kind === 'approval') return null
  if (kind === 'life_event') return 'travel'
  if (kind === 'idea') return 'ideas'
  if (kind === 'run' || kind === 'browser_blocker') return 'tasks'
  if (kind === 'open_loop') {
    const source = String(loop?.source_type || '')
    if (/service_notice|bill|payment/.test(source)) return 'bills'
    if (loop?.kind === 'life_event') return 'travel'
    if (/calendar/.test(source)) return 'calendar'
    if (loop?.kind === 'followup' || loop?.kind === 'waiting_on') return 'replies'
    return 'tasks'
  }
  return 'tasks'
}

export function allowedByTopic(prefs: Pick<AlertPreferences, 'topics'>, topic: AlertTopic | null): boolean {
  return topic === null || prefs.topics[topic] !== false
}

