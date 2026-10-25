// Chat commands for the "emails that need you" card. Pure parsing; no I/O, so routes can pre-filter cheaply.

export type AttentionCommand =
  | { type: 'show' }
  | { type: 'not_important' | 'important' | 'draft' | 'remind' | 'why' | 'open'; index: number; when?: string }
  | { type: 'rules' }
  | { type: 'undo' }
  | { type: 'rule_text'; kind: 'always' | 'never'; target: string }
  | { type: 'remove_rule'; target: string }

function norm(text: string) {
  return String(text || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim()
}

const NUM = '(?:#|no\\.?\\s*|number\\s*|email\\s*)?([1-9])'

export function parseAttentionCommand(text: string): AttentionCommand | null {
  const t = norm(text)
  if (!t || t.length > 140) return null
  let m: RegExpMatchArray | null
  if ((m = t.match(new RegExp(`^(?:not important|not urgent|ignore|skip|unimportant|don't flag|dont flag)\\s+${NUM}$`)))) return { type: 'not_important', index: Number(m[1]) }
  if ((m = t.match(new RegExp(`^(?:important|always flag|keep flagging|this is important)\\s+${NUM}$`)))) return { type: 'important', index: Number(m[1]) }
  if ((m = t.match(new RegExp(`^(?:draft(?: a)?(?: reply)?(?: to)?|reply to)\\s+${NUM}$`)))) return { type: 'draft', index: Number(m[1]) }
  if ((m = t.match(new RegExp(`^remind(?: me)?(?: about)?\\s+${NUM}(?:\\s+(.{2,60}))?$`)))) return { type: 'remind', index: Number(m[1]), when: m[2]?.trim() }
  if ((m = t.match(new RegExp(`^(?:why(?: did you pick| this| is)?|why)\\s+${NUM}\\??$`)))) return { type: 'why', index: Number(m[1]) }
  if ((m = t.match(new RegExp(`^(?:open|show|read)\\s+${NUM}$`)))) return { type: 'open', index: Number(m[1]) }
  if (/^(?:what do you flag(?: for me)?|(?:my |show (?:my )?)?email (?:rules|attention rules|filters)|what counts as important(?: email)?)\??$/.test(t)) return { type: 'rules' }
  if (/^(?:what|which|any)\b.{0,30}\b(?:emails?|mails?|inbox)\b.{0,30}\b(?:need|needs|needing) (?:me|my attention|attention)\??$|^(?:emails?|mails?) (?:that )?needs? (?:me|my attention)\??$|^(?:check|scan) my (?:email|mail|inbox)(?: for (?:anything )?(?:important|urgent))?$|^any (?:important|urgent) (?:emails?|mails?)(?: today)?\??$/.test(t)) return { type: 'show' }
  if ((m = t.match(/^(?:always flag|always show|flag) (?:mails?|emails?) from (.{2,60})$/))) return { type: 'rule_text', kind: 'always', target: m[1].trim() }
  if ((m = t.match(/^(?:never flag|stop flagging|don't flag|dont flag|ignore) (?:mails?|emails?) from (.{2,60})$/))) return { type: 'rule_text', kind: 'never', target: m[1].trim() }
  if ((m = t.match(/^(?:remove|delete|forget) (?:the )?(?:email )?rule (?:for |about )?(.{2,60})$/))) return { type: 'remove_rule', target: m[1].trim() }
  return null
}

/** "undo" only binds when the previous Gogo reply was an email-attention change; the caller checks that. */
export function isUndo(text: string) {
  return /^(?:undo|undo that|take that back)$/.test(norm(text))
}

/** Cheap pre-filter for routes: true when the message could be an attention command. */
export function mightBeAttentionCommand(text: string) {
  return Boolean(parseAttentionCommand(text)) || isUndo(text)
}
