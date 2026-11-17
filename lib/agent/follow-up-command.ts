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
const HANDLED = /^(?:yes|yep|yeah|ya|yup|yes yes|done|all done|handled|sorted|fixed|paid|recharged|resolved|taken care of|already done|did it|yes,? (?:done|handled|sorted|it is|it has|it has been|i did|i have|paid|recharged|all done))$/
const NOT_YET = /^(?:no|nope|nah|not yet|no not yet|not done|still pending|pending|not handled|no,? (?:not yet|not done|still pending))$/
export function parseFollowUpAnswer(text: unknown): 'handled' | 'not_yet' | null {
  const t = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[\u{1F44D}\u{1F64F}\u2705\uFE0F]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase().replace(/[.!]+$/, '').trim()
  if (!t) return null
  if (HANDLED.test(t)) return 'handled'
  if (NOT_YET.test(t)) return 'not_yet'
  return null
}
export const isFollowUpAnswer = (text: unknown): boolean => parseFollowUpAnswer(text) !== null
