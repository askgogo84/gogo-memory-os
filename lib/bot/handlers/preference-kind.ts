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

const ONE_TIME = /\b(?:this time|just (?:this )?once|only (?:this )?once|just for (?:today|now|this)|only (?:for )?today|for this (?:one|email|mail|message|report|doc|document|task|trip|order|booking|reply|draft)|in this (?:one|email|report|reply|draft)|on this (?:one|email|report))\b/i
// "for now" marks a one-time instruction unless the person also said always / from now on / forever.
const FOR_NOW = /\bfor now\b/i, STANDING = /\b(?:always|from now on|forever|every ?time|going forward)\b/i
const TAIL = "(?:\\s+(?:please|pls|plz|ok(?:ay)?))?[.!\\s]*$"
const CORRECTION = new RegExp(`^(?:never|don'?t|do not)\\s+(?:ever\\s+)?(?:make|do|repeat)\\s+(?:that|this|the same)(?:\\s+(?:mistake|error|thing))?(?:\\s+again)?${TAIL}|^(?:that(?:'s| is| was)|this is) (?:wrong|a mistake|not right|incorrect)${TAIL}`, 'i')
const WIDE: RegExp[] = [
  /^(?:please\s+)?(?:i\s+(?:would\s+|'d\s+)?prefer\s+(?:it\s+when\s+you\s+|you\s+to\s+(?:always\s+)?|that\s+you\s+(?:always\s+)?)?|i\s+(?:want|would\s+like|'d\s+like)\s+you\s+to\s+(?:always\s+)?)(.+)/i,
  /^(?:please\s+)?never\s+(.+)/i,
  /^(?:please\s+)?(?:don'?t|do not)\s+(?:ever\s+)?(.+)/i,
  /^(?:please\s+)?use\s+(this|the following|that)\s+(format|template|style|tone|structure|sign[- ]?off|greeting)\s+for\s+(.+)/i,
  /^(?:please\s+)?(?:keep|make)\s+(?:all\s+)?my\s+(.+)/i,
  /^(?:in|for)\s+(?:all\s+)?(?:my\s+)?(?:future\s+)?(emails?|reports?|replies|messages|briefs?|summaries|reminders?|lists?)[,:]?\s+(.+)/i,
]
const WIDE_PREFIX = ['', 'never ', "don't ", '', '', '']
// What makes "I prefer …" / "don't …" a way of working and not a choice or an errand for right now: a word that says
// it holds from here on, or the kind of thing Gogo writes or shows.
const DURABLE = /\b(?:always|ever|from now on|in (?:the )?future|going forward|every ?time|each time|whenever|by default|any ?more|again|as a rule|in general|generally|usually)\b|\b(?:in|for) (?:all )?(?:my |your )?(?:e-?mails?|reports?|replies|messages|briefs?|summaries|reminders|lists|answers|responses)\b|\b(?:my|your) (?:e-?mails|reports|replies|messages|briefs|summaries|lists|answers|responses)\b|\bwhen (?:you|writing|replying|drafting|talking|messaging)\b|\b(?:call|address) me\b|\b(?:dashboard|home ?screen|replies|answers|responses|tone|format|formatting|style|language|bullet points?|bullets|emojis?|24[- ]hour|12[- ]hour)\b/i
const ERRAND = /\b(?:book|order|buy|send|call|pay|remind|schedule|cancel|delete|add|include)\s+(?:it|this|that|them)\b|\b(?:right now|today|tomorrow|tonight|yet)\b/i
const CHAT_NEVER = /^(?:mind|been|heard|seen|had|have|has|was|were|did|do i|thought|knew|again|ever|say|gonna|going|got|gotten|received|tried|would|could|should|will|can|give up|gave|went|saw|felt|liked|wanted|trust)\b/i
const CHAT_DONT = /^(?:forget|worry|bother|be|you|have|know|think|like|want|care|mind|understand|get it|change$|ever change$)/i
const DEICTIC = /^\w+\s+(?:that|this|it|them|those|these)\b/i
const KEEP_NOUN = /^(?:e-?mails?|reports?|replies|messages|briefs?|summaries|reminders|lists|answers|responses|dashboard)\s+\S+/i
const SCOPED_LEAD = /^(?:always|never|don'?t|do not|use|be|avoid|prefer|sign (?:off|as)|start with|end with|address)\b/i
// "I want you to …" is a request unless it says it holds from here on.
const WANT = /^(?:please\s+)?i\s+(?:want|would\s+like|'d\s+like)\b/i
const NOT_KEPT = /\b(?:coming|ready|open|default|safe|handy|there|posted)\s*$/i
const JUST_NOW = /\b(?:now|yesterday|link|for this|this one|that one)\b/i
const LEAD_IN = /^(?:(?:ok(?:ay)?|hey|hi|please|pls|gogo)[\s,]+)+/i

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
const stored = (t: string, rule: string): PreferenceKind => ({ kind: 'durable', rule, scope: scopeOf(rule), restrictive: isRestrictive(t) })

/** `wide` false: only today's phrasings (always…, from now on…, …) are preferences, with today's rule text; the
 *  permission check still applies to them. `wide` true: also the Addendum 5 phrasings, one-time instructions and
 *  bare corrections. */
export function classifyPreference(text: string, wide: boolean): PreferenceKind {
  const raw = String(text || '').trim()
  if (!raw) return null
  if (!wide || raw.length > 600) {
    const rule = detectPreferenceSave(raw)
    if (!rule) return null
    return grantsPermission(raw) || grantsPermission(rule) ? { kind: 'permission', rule } : stored(raw, rule)
  }
  const t = raw.replace(/[‘’]/g, "'")
  if (CORRECTION.test(t)) return { kind: 'correction' }
  // "please always reply in Kannada", "ok always use bullets", "From now on: short replies"
  let rule = detectPreferenceSave(t) || detectPreferenceSave(t.replace(LEAD_IN, '').replace(/^from now on\s*[:–-]\s*/i, 'from now on '))
  const explicit = Boolean(rule)
  let shape = -1
  if (!rule) {
    // A question or a list is not a preference.
    if (/\?\s*$/.test(t) || /\n/.test(t)) return null
    for (let i = 0; i < WIDE.length; i++) {
      const m = t.match(WIDE[i])
      if (!m) continue
      rule = i === 3 ? tidy(`use ${m[1]} ${m[2]} for ${m[3]}`) : i === 4 ? tidy(t.replace(/^please\s+/i, '')) : i === 5 ? tidy(`in ${m[1]}, ${m[2]}`) : tidy(`${WIDE_PREFIX[i]}${m[1]}`)
      shape = i
      // A choice, an errand for right now or small talk is not a way of working: "I prefer the window seat",
      // "don't book it yet", "never heard of it", "keep my booking", "in my reminders, add milk".
      const body = String(m[i === 5 ? 2 : 1] || '').trim()
      const plain = i === 0 ? (WANT.test(t) ? STANDING.test(t) : DURABLE.test(t) && !JUST_NOW.test(body)) && !ERRAND.test(body)
        : i === 1 ? !CHAT_NEVER.test(body) && !DEICTIC.test(body) && !ERRAND.test(body)
        : i === 2 ? (DURABLE.test(t) || isRestrictive(t)) && !CHAT_DONT.test(body) && !DEICTIC.test(body) && !ERRAND.test(body)
        : i === 3 ? !/\b(?:the|this|that)\b/i.test(String(m[3] || '')) && !ERRAND.test(String(m[3] || ''))
        : i === 4 ? KEEP_NOUN.test(body) && !NOT_KEPT.test(body)
        : i === 5 ? SCOPED_LEAD.test(body) : true
      // A grant is refused out loud even when it would not have been kept as a rule.
      if (!plain && !(grantsPermission(t) || grantsPermission(rule))) return null
      break
    }
  }
  if (!rule || rule.length <= 2) return null
  if (grantsPermission(t) || grantsPermission(rule)) return { kind: 'permission', rule }
  if (ONE_TIME.test(t) || (FOR_NOW.test(t) && !(explicit && STANDING.test(t)) && !/\bforever\b/i.test(t))) return { kind: 'one_time' }
  void shape
  return stored(t, rule)
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
