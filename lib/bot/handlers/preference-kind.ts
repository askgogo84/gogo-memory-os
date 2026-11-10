// Same Brain 3.0, Addendum 5 (P1): what kind of instruction is "always make my reports concise"?
//
// Pure. Reads one message and says whether it is a standing preference to keep, an instruction for this one task
// (never stored), a correction with nothing to store yet, or an attempt to give Gogo permission to act without asking.
// The last is never stored as a preference, whatever the flag says: a preference shapes how Gogo writes and works,
// and approvals are changed only in Trust settings, where each kind of action has its own switch.
//
// The wider phrasings ("I prefer…", "never…", "don't…", "use this format for my emails") and the one-time and
// correction handling are used only when GOGO_PREFERENCE_LEARNING is "on" or lists the owner.
import { detectPreferenceSave } from './preferences'

type Env = Record<string, string | undefined>
export function preferenceLearningEnabledFor(owner: string, env: Env = process.env): boolean {
  const v = String(env.GOGO_PREFERENCE_LEARNING || '').trim()
  return v === 'on' || (Boolean(owner) && v.split(',').map(s => s.trim()).includes(owner))
}

export type PreferenceScope = 'emails' | 'reports' | 'reminders' | 'lists' | 'dashboard' | 'general'
export type PreferenceKind =
  | { kind: 'durable'; rule: string; scope: PreferenceScope; restrictive: boolean }
  | { kind: 'permission'; rule: string }
  | { kind: 'one_time' }
  | { kind: 'correction' }
  | null

export { grantsPermission, isRestrictive } from './preference-permission'
import { grantsPermission, isRestrictive } from './preference-permission'

const ONE_TIME = /\b(?:this time|for now|just (?:this )?once|only (?:this )?once|just for (?:today|now|this)|only (?:for )?today|for this (?:one|email|mail|message|report|doc|document|task|trip|order|booking|reply|draft)|in this (?:one|email|report|reply|draft)|on this (?:one|email|report))\b/i
const CORRECTION = /^(?:never|don'?t|do not)\s+(?:ever\s+)?(?:make|do|repeat)\s+(?:that|this|the same)(?:\s+(?:mistake|error|thing))?(?:\s+again)?[.!\s]*$|^(?:that(?:'s| is| was)|this is) (?:wrong|a mistake|not right|incorrect)[.!\s]*$|^(?:don'?t|do not|never) do that again[.!\s]*$/i
const WIDE: RegExp[] = [
  /^(?:please\s+)?(?:i\s+(?:would\s+|'d\s+)?prefer\s+(?:it\s+when\s+you\s+|you\s+to\s+(?:always\s+)?|that\s+you\s+(?:always\s+)?)?|i\s+(?:want|would\s+like|'d\s+like)\s+you\s+to\s+(?:always\s+)?)(.+)/i,
  /^(?:please\s+)?never\s+(.+)/i,
  /^(?:please\s+)?(?:don'?t|do not)\s+(?:ever\s+)?(.+)/i,
  /^(?:please\s+)?use\s+(this|the following|that)\s+(format|template|style|tone|structure|sign[- ]?off|greeting)\s+for\s+(.+)/i,
  /^(?:please\s+)?(?:keep|make)\s+(?:all\s+)?my\s+(.+)/i,
  /^(?:in|for)\s+(?:all\s+)?(?:my\s+)?(?:future\s+)?(emails?|reports?|replies|messages|briefs?|summaries|reminders?|lists?)[,:]?\s+(.+)/i,
]
const WIDE_PREFIX = ['', 'never ', "don't ", '', '', '']

export function scopeOf(rule: string): PreferenceScope {
  const t = rule.toLowerCase()
  if (/\be-?mails?\b|\bmails?\b|\brepl(?:y|ies)\b|\bsign[- ]?off\b|\bsubject lines?\b/.test(t)) return 'emails'
  if (/\breports?\b|\bbriefs?\b|\bsummar(?:y|ies)\b|\bdocs?\b|\bdocuments?\b|\bone[- ]pagers?\b/.test(t)) return 'reports'
  if (/\breminders?\b/.test(t)) return 'reminders'
  if (/\blists?\b/.test(t)) return 'lists'
  if (/\bdashboard\b|\bhome (?:page|screen)\b|\btasks page\b/.test(t)) return 'dashboard'
  return 'general'
}

const tidy = (s: string) => s.trim().replace(/[.\s]+$/, '').slice(0, 300)

/** `wide` false: only today's phrasings (always…, from now on…, …) are preferences, as before; the permission check
 *  still applies to them. `wide` true: also the Addendum 5 phrasings, one-time instructions and bare corrections. */
export function classifyPreference(text: string, wide: boolean): PreferenceKind {
  const t = String(text || '').replace(/[‘’]/g, "'").trim()
  if (!t || t.length > 600) return null
  if (wide && CORRECTION.test(t)) return { kind: 'correction' }
  let rule = detectPreferenceSave(t)
  if (!rule && wide) {
    // A question, a request to do something now, or a list is not a preference.
    if (/\?\s*$/.test(t) || /\n/.test(t)) return null
    for (let i = 0; i < WIDE.length; i++) {
      const m = t.match(WIDE[i])
      if (!m) continue
      rule = i === 3 ? tidy(`use ${m[1]} ${m[2]} for ${m[3]}`) : i === 4 ? tidy(t.replace(/^please\s+/i, '')) : i === 5 ? tidy(`in ${m[1]}, ${m[2]}`) : tidy(`${WIDE_PREFIX[i]}${m[1]}`)
      break
    }
    // "don't …" and "never …" are standing rules only when they say how Gogo should write or work, or add a stop
    // before an action; "don't forget to call Divya" and "never mind" are not.
    if (rule && /^(?:never|don't) /i.test(rule) && (/^(?:never mind|don't (?:forget|worry|bother)|never\s+mind)\b/i.test(rule) || rule.split(/\s+/).length < 3)) return null
    if (rule && rule.length <= 2) rule = null
    // A choice or an errand for right now ("I prefer the 8 pm show, book it") is a request, not a way of working.
    if (rule && !grantsPermission(t) && !isRestrictive(t) && (/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test(rule) || /\b(?:book|order|buy|send|call|pay|remind|schedule)\s+(?:it|this|that|them|me)\b/i.test(rule) || /\b(?:right now|today|tomorrow|tonight)\b/i.test(rule))) return null
  }
  if (!rule) return null
  if (grantsPermission(t) || grantsPermission(rule)) return { kind: 'permission', rule }
  if (wide && ONE_TIME.test(t)) return { kind: 'one_time' }
  return { kind: 'durable', rule, scope: scopeOf(rule), restrictive: isRestrictive(t) }
}

export const PERMISSION_REPLY = 'I haven’t saved that as a rule. A preference changes how I write and work for you; it can’t give me leave to send, pay, book or contact anyone without your yes. If you want fewer approval prompts for a kind of action, change it in Settings › Trust, where each one has its own switch.'
export const CORRECTION_REPLY = 'Sorry about that. Tell me the rule in one line, starting with “always” or “never”, and I’ll keep it for next time. For example: never shorten names in my emails.'
const SCOPE_WORDS: Record<PreferenceScope, string> = { emails: 'your emails', reports: 'your reports and briefs', reminders: 'your reminders', lists: 'your lists', dashboard: 'your dashboard', general: 'everything I do for you' }
/** The confirmation for a saved rule: what was kept, where it applies, how to see or remove it, and what it is not. */
export function savedReply(p: { rule: string; scope: PreferenceScope; restrictive: boolean }): string {
  return [`Saved as a standing rule for ${SCOPE_WORDS[p.scope]}: “${p.rule}”.`,
    p.restrictive ? 'That is already how I work: I stop for your yes before anything goes to anyone. I’ll keep the rule so it stays that way.' : '',
    'Say *my rules* to see them all, or *forget rule about …* to remove one.'].filter(Boolean).join('\n')
}
