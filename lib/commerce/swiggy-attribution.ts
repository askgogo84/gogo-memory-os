// Swiggy Integration Agreement 3.4 / 4(iii) and Swiggy brand guidelines: every result, cart and confirmation that
// shows Swiggy content carries the exact phrase for that service. Text-only channels (WhatsApp) still need the full
// phrase with results and confirmations; a one-time footer is not enough. Never abbreviate, translate or reword.
export type SwiggyService = 'food' | 'instamart' | 'dineout'

const PHRASE: Record<SwiggyService, string> = {
  food: 'Powered by Swiggy',
  instamart: 'Powered by Instamart',
  dineout: 'Powered by Dineout',
}

export function poweredBy(service: SwiggyService): string {
  return PHRASE[service]
}

/** Puts the attribution on its own line straight after the first line (the result heading). Idempotent. */
export function withSwiggyAttribution(text: string, service: SwiggyService): string {
  const phrase = PHRASE[service]
  if (text.split('\n').some(line => line.trim() === phrase)) return text
  const cut = text.indexOf('\n')
  return cut === -1 ? text + '\n' + phrase : text.slice(0, cut) + '\n' + phrase + text.slice(cut)
}
