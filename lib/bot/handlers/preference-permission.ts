// Same Brain 3.0, Addendum 5: would this "preference" give Gogo leave to act without the person's yes?
// Pure and dependency-free, so every place that stores a rule or hands stored rules to a model can use it
// (lib/bot/handlers/preference-kind.ts, preferences.ts, lib/agent/context-brain.ts, understanding-context.ts).
// A preference shapes how Gogo writes and works. Approvals are changed only in Trust settings.

// Things Gogo does that reach someone else or cost money or cannot be undone.
const ACT = '(?:send(?:ing)?|e-?mail(?:ing)?|mail(?:ing)?|messag(?:e|ing)|text(?:ing)?|whatsapp(?:ing)?|repl(?:y|ying)|contact(?:ing)?|call(?:ing)?|invit(?:e|ing)|post(?:ing)?|publish(?:ing)?|shar(?:e|ing)|forward(?:ing)?|pay(?:ing)?|purchas(?:e|ing)|buy(?:ing)?|order(?:ing)?|book(?:ing)?|reserv(?:e|ing)|cancel(?:ling|ing)?|delet(?:e|ing)|transfer(?:ring)?|approv(?:e|ing)|confirm(?:ing)?|submit(?:ting)?|sign(?:ing)?(?: ?up)?|unsubscrib(?:e|ing))'
const ASK = "(?:ask(?:ing)?(?: me| first)?|approval|approv(?:e|ing)|confirm(?:ation|ing)?|permission|check(?:ing)? with me|my (?:ok|okay|yes|go[- ]ahead|consent|say[- ]so)|wait(?:ing)? for me|a (?:yes|go[- ]ahead))"
const GRANTS: RegExp[] = [
  // "send emails without asking", "book it without my approval", "pay … without confirmation"
  new RegExp(`\\b${ACT}\\b[^.!?]{0,80}\\b(?:without|w/o|with no|skip(?:ping)?|bypass(?:ing)?|no need (?:for|to)|needn'?t|don'?t need(?: to)?|do not need(?: to)?)\\s+(?:any\\s+|my\\s+|an?\\s+|the\\s+|to\\s+|further\\s+)*${ASK}`, 'i'),
  // "don't ask me before sending", "never ask for approval", "stop asking me to confirm", "no need to ask before you book"
  new RegExp(`\\b(?:don'?t|do not|never|stop|quit|no need to|needn'?t|you don'?t (?:have|need) to)\\s+(?:ever\\s+|keep\\s+)?(?:ask(?:ing)?|wait(?:ing)?|check(?:ing)?|confirm(?:ing)?|seek(?:ing)?|request(?:ing)?|show(?:ing)?)\\b[^.!?]{0,60}\\b(?:${ASK}|${ACT}|card|cards)\\b`, 'i'),
  // "auto-approve", "approve everything", "you are pre-approved", "skip approvals"
  /\bauto[- ]?(?:approv|confirm|send|pay|book)\w*/i,
  /\b(?:approve|confirm|accept|allow)\s+(?:everything|all|anything|every\s+\w+)\b/i,
  /\b(?:pre[- ]?approved|blanket (?:approval|permission)|standing (?:approval|permission)|skip(?:ping)? (?:the )?approvals?|turn off (?:the )?approvals?|disable (?:the )?approvals?|no approvals?)\b/i,
  // "you can always send/pay/book …", "you may go ahead and book …", "just send it", "go ahead and pay"
  new RegExp(`\\b(?:you (?:can|may|are allowed to|have (?:my )?permission to)|feel free to|just|go ahead and|directly)\\s+(?:always\\s+|just\\s+|go ahead and\\s+|directly\\s+)*${ACT}\\b(?!\\s+(?:me|myself|my name)\\b)`, 'i'),
  // "act on my behalf without …", "full access", "do whatever it takes"
  /\b(?:do|take) whatever (?:it takes|you want|is needed)\b|\bfull (?:access|control|autonomy|authority)\b|\bon my behalf\b[^.!?]{0,40}\bwithout\b/i,
  // elevated or override instructions dressed as a preference
  /\b(?:ignore|override|bypass|disregard)\s+(?:the\s+|your\s+|all\s+|any\s+)*(?:rules?|safety|polic(?:y|ies)|limits?|guard\w*|restrictions?|instructions?|sentinel|trust)\b/i,
]
// "don't contact anyone without my approval", "always ask before sending", "never send without checking with me"
const RESTRICTS: RegExp[] = [
  new RegExp(`\\b(?:don'?t|do not|never)\\s+(?:ever\\s+)?${ACT}\\b[^.!?]{0,80}\\b(?:without|unless|until|before)\\b`, 'i'),
  new RegExp(`\\b(?:always\\s+)?(?:ask|check with|confirm with|wait for|show)\\s+me\\b[^.!?]{0,40}\\b(?:before|first)\\b`, 'i'),
  new RegExp(`\\b(?:always\\s+)?(?:ask|get|take|wait for)\\s+(?:for\\s+)?(?:my\\s+)?(?:approval|permission|confirmation|ok|okay|go[- ]ahead)\\s+(?:before|first)\\b`, 'i'),
  new RegExp(`\\b(?:don'?t|do not|never)\\s+(?:ever\\s+)?${ACT}\\b(?![^.!?]*\\b(?:ask|approval|confirm|permission|check)\\w*\\b)`, 'i'),
]

const NO_ASK = new RegExp(`\\b(?:don'?t|do not|never|stop|quit|no need to|needn'?t|you don'?t (?:have|need) to)\\s+(?:ever\\s+|keep\\s+)?(?:ask(?:ing)?|wait(?:ing)?|check(?:ing)?|confirm(?:ing)?|seek(?:ing)?|request(?:ing)?)\\b[^.!?]{0,60}\\b(?:${ASK}|${ACT}|me|first|before)\\b`, 'i')

/** Would storing this as a rule try to give Gogo leave to act without the person's yes? */
export function grantsPermission(text: string): boolean {
  const t = String(text || '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
  if (!t) return false
  // "don't ask me before sending", "never wait for my approval": the stop itself is being switched off.
  if (NO_ASK.test(t)) return true
  // A rule that only adds a stop ("don't email anyone without my approval") is not a grant.
  if (RESTRICTS.slice(0, 3).some(r => r.test(t)) && !/\bauto[- ]?approv|\bpre[- ]?approved|\bskip\w* (?:the )?approvals?\b/i.test(t)) return false
  return GRANTS.some(r => r.test(t))
}
export function isRestrictive(text: string): boolean {
  const t = String(text || '').replace(/[‘’]/g, "'")
  return RESTRICTS.some(r => r.test(t)) && !grantsPermission(t)
}

