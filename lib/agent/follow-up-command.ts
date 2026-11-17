// "stop follow-ups" / "start follow-ups": the one definition of what counts as the command (15 Nov audit: this
// pattern was written three times — parser, WhatsApp bridge, webhook gate). Dependency-free on purpose.
const STOP = /^(?:stop|pause|turn off|no more)\s+follow[\s-]?ups?$/
const START = /^(?:start|resume|turn on)\s+follow[\s-]?ups?$/

export function parseFollowUpCommand(text: string): 'stop' | 'start' | null {
  const t = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase().replace(/[.!]+$/, '')
  if (STOP.test(t)) return 'stop'
  if (START.test(t)) return 'start'
  return null
}

export const isFollowUpCommand = (text: unknown): boolean => parseFollowUpCommand(String(text ?? '')) !== null

// 17 Nov live: Gogo asked "Twilio: … Has it been handled?" and the person's "Yes" got "I'm not sure what you're
// saying yes to". A short yes/no right after a follow-up answers that follow-up. Pure; the caller checks that a
// follow-up was the last thing said.
// "yes"/"no" answer the question asked; a done-word ("done", "paid", "recharged") says the thing itself is finished.
const YES = /^(?:yes|yess|yep|yeah|yea|ya|yup|yes yes|haan|haan ji|ha|ji|yes sir|yes boss|yes,? (?:it is|it has|it has been|i did|i have))$/
const DONE = /^(?:done|all done|done already|already done|done boss|done sir|handled|sorted|fixed|paid|recharged|resolved|completed|taken care of|did it|i did|ho gaya|kar diya|it'?s done|it is done|(?:yes|ya|haan),? (?:done|handled|sorted|paid|recharged|all done|handled it|ho gaya|kar diya))$/
const NOT_YET = /^(?:no|nope|nah|nahi|abhi nahi|not yet|not yet done|no not yet|not done|still pending|pending|not handled|baaki hai|no,? (?:not yet|not done|still pending))$/
export type FollowUpAnswer = { answer: 'handled' | 'not_yet'; doneWord: boolean }
export function parseFollowUpAnswerDetail(text: unknown): FollowUpAnswer | null {
  const t = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase()
  if (/^[\u{1F44D}\u2705\u2714\uFE0F\u{1F3FB}-\u{1F3FF} ]+$/u.test(t)) return { answer: 'handled', doneWord: false } // a lone thumbs-up or tick
  const w = t.replace(/[\u{1F44D}\u{1F64F}\u2705\u2714\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, ' ').replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim()
  if (!w) return null
  if (DONE.test(w)) return { answer: 'handled', doneWord: true }
  if (YES.test(w)) return { answer: 'handled', doneWord: false }
  if (NOT_YET.test(w)) return { answer: 'not_yet', doneWord: false }
  return null
}
export function parseFollowUpAnswer(text: unknown): 'handled' | 'not_yet' | null { return parseFollowUpAnswerDetail(text)?.answer ?? null }
export const isFollowUpAnswer = (text: unknown): boolean => parseFollowUpAnswer(text) !== null
