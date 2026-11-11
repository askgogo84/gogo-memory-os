// Gogo's voice, step 1 (owner, 11 Nov 2026): "Why should it say Draft updated and all.. it should say something nice."
//
// This file changes wording by rule, in code. No model writes or rewrites a reply here.
//
// Why not a model: the first version of this file asked a model to re-word a finished reply and then checked the
// result in code (dates, times, amounts, links, bold words, question marks, action words). An independent review found
// about 45 rewrites that passed every check and still misled: "I have not messaged anyone" became "I have messaged
// everyone"; "Cancel … ? Reply *yes*" became "Keep … as it is? Reply *yes*" (the next yes would cancel); two guests'
// personal links were swapped; a held goal was reported as done. Checking tokens does not check meaning, so a model is
// not allowed to re-word replies that state what was or was not done.
//
// What this does instead: for the two replies the owner pointed at (an event draft just started, an event draft just
// changed), the status header and the "· place not set" line are replaced by one plain sentence built by code from the
// same three facts already in the reply (name, when, where). Everything after it (extra lines, the question, the words
// to type) is kept exactly. Any reply that is not exactly one of those shapes is returned unchanged.
//
// Off unless GOGO_VOICE is "on" or lists the owner's id. No action, approval or gate is touched: the feature has
// finished its work before the words are chosen.

type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env
export function voiceEnabledFor(owner: string, env: Env = envOf()): boolean {
  const v = String(env.GOGO_VOICE || '').trim()
  return v === 'on' || (Boolean(owner) && v.split(',').map(s => s.trim()).includes(owner))
}

// Exactly what lib/events/entry.ts afterDraftChange writes for a draft: header, blank line, *name*, "when · where",
// optional extra lines, blank line, the next step. "Updated." (a published event, which guests can see) is not here on
// purpose: that reply stays as written.
const DRAFT = /^(Draft started|Draft updated)\.\n\n(\*[^*\n]{1,120}\*)\n([^\n·]{1,80}) · ([^\n]{1,160})((?:\n[^\n]+)*)\n\n([\s\S]+)$/
const NO_DATE = 'date not set', NO_PLACE = 'place not set'

/** Pure. The event-draft reply with its status header said as a sentence; any other text unchanged. */
export function eventDraftInPlainWords(reply: string): string {
  const m = String(reply || '').match(DRAFT)
  if (!m) return reply
  const [, head, name, whenRaw, whereRaw, extras, next] = m
  const when = whenRaw.trim(), where = whereRaw.trim()
  const hasWhen = when !== NO_DATE, hasWhere = where !== NO_PLACE
  const started = head === 'Draft started'
  const lead = started
    ? (hasWhen && hasWhere ? `I’ve started planning ${name}: ${when} at ${where}.`
      : hasWhen ? `I’ve started planning ${name} for ${when}.`
      : hasWhere ? `I’ve started planning ${name} at ${where}.`
      : `I’ve started planning ${name}.`)
    : (hasWhen && hasWhere ? `Noted. ${name}: ${when} at ${where}.`
      : hasWhen ? `Noted. ${name}: ${when}. The place is still open.`
      : hasWhere ? `Noted. ${name} at ${where}. The date is still open.`
      : `Noted. ${name}: the date and place are still open.`)
  return `${lead}${extras}\n\n${next}`
}

export type VoiceInput = { owner: string; reply: string; kind: string }
/** The reply as it should be sent. Never throws. Only `kind: 'events'` is changed, and only for its two draft shapes. */
export function inGogosVoice(input: VoiceInput, deps: { env?: Env } = {}): string {
  const original = String(input?.reply || '')
  try {
    if (input.kind !== 'events' || !voiceEnabledFor(String(input.owner || ''), deps.env || envOf())) return original
    return eventDraftInPlainWords(original)
  } catch { return original }
}
