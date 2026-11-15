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
