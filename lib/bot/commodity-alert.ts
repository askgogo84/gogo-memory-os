// "Alert me if gold goes above ₹80,000 per 10g": Gogo can tell the current rate but does not yet compare a
// live rate against a threshold in the background. Say so plainly instead of letting a chat model claim an alert
// was set. Zero-import so every router can use it.
const ALERT_LEAD_RE = /\b(?:alert|tell|notify|ping|message|inform)\s+me\b|\blet\s+me\s+know\b|\bsend\s+me\s+an?\s+alert\b/i
const COMMODITY_RE = /\b(?:gold|silver|petrol|diesel|bitcoin|btc|ethereum|eth|nifty|sensex|crude)\b/i
const LEVEL_RE = /\b(?:above|over|below|under|crosses?|hits?|reaches?|touch(?:es)?|goes?\s+(?:above|over|below|under|to)|falls?\s+(?:below|under|to)|drops?\s+(?:below|under|to)|rises?\s+(?:above|over|to))\b/i
const MONEY_RE = /(?:₹|rs\.?|inr|\$)\s*\d|\d[\d,]*\s*(?:k|rupees|rs|inr)\b|\b\d{4,}\b/i

export function isCommodityAlertRequest(text: string): boolean {
  const t = String(text || '')
  return ALERT_LEAD_RE.test(t) && COMMODITY_RE.test(t) && LEVEL_RE.test(t) && MONEY_RE.test(t)
}

export const COMMODITY_ALERT_REPLY =
  "I can tell you today's rate any time — just ask, for example *gold price today* — but I can't watch a rate against a " +
  "level in the background yet, so no alert is set.\n\nI can remind you to check it at a time you choose. Want that?"
