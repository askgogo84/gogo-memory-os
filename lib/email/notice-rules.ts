// Pure text rules shared by the attention scorer and the open-loop notice capture (no imports, so sandboxed
// harnesses and both callers judge the same way).
//
// 13 Nov comparison: WeWork's "access and keycards deactivate around 3pm tomorrow if the ₹35,841.29 dues aren't
// settled" and Apify's breach notice ("your account data was viewed") reached no rule. Review: a loose version of these
// rules flagged payment receipts, every telecom/card/EMI reminder, "outstanding job" mail and KYC phishing as service
// cut-offs, so the dues rule needs money + loss of access + a near-term time, and refuses paid/restored and phishing.

const PAID = /\b(?:paid|payment\s+(?:received|successful|confirmed)|received\s+your\s+payment|thank\s+you\s+for\s+(?:your\s+)?payment|cleared|restored|reactivated|will\s+not\s+be|won'?t\s+be|no\s+longer)\b/i
/** KYC/verify/click-a-link wording and throwaway domains: the shape of account-blocking phishing. */
export const PHISHY = /\bkyc\b|\bverify\s+(?:your\s+)?(?:account|details|identity|now)\b|\bclick\s+(?:here|the\s+link|below)\b|\bupdate\s+now\b|\bbit\.ly\b|\btinyurl\b|\b[a-z0-9-]+\.(?:xyz|top|click|link|info|icu|buzz)\b/i
const SOON = /\b(?:today|tonight|tomorrow|within\s+(?:24|48)\s*(?:h|hrs?|hours?)\b|in\s+(?:24|48)\s+hours|(?:by|at|around|before)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i
const MONEY = /(?:₹|\brs\.?|\binr)\s?\d|\bdues\b/i
const LOSS = /\b(?:deactivat(?:e|ed|es|ion)|disconnect(?:ed|ion)?|suspend(?:ed|ing)?|suspension|(?:access|keycards?|account|service)s?\s+(?:will\s+be\s+|to\s+be\s+)?(?:revoked|removed|disabled|blocked|deactivated|cut\s+off|stopped))\b/i

/** Service about to be cut off: the original payment-failed rule, or money owed + loss of access + a near-term time. */
export function isServiceCutoffText(text: string): boolean {
  const t = String(text || '')
  const failed = /\b(?:payment\s+(?:failed|declined)|billing\s+(?:failed|overdue)|overdue\s+invoice)\b/i.test(t)
    && /\b(?:shutdown|shut\s*down|suspend(?:ed|ing)?|suspension|service\s+interruption|action\s+required|disconnect)\b/i.test(t)
  if (failed) return true
  return MONEY.test(t) && LOSS.test(t) && SOON.test(t) && !PAID.test(t) && !PHISHY.test(t)
}

/** The long-standing sign-in / password / locked-account alerts (unchanged; scored as security, never captured). */
export function isAccountAlertText(text: string): boolean {
  return /\b(?:suspicious|unusual)\s+(?:sign[- ]?in|login|activity)\b|\bpassword (?:was )?changed\b|\baccount (?:locked|compromised)\b/i.test(String(text || ''))
}

const BREACH = /\b(?:security\s+(?:incident|breach)|data\s+breach|unauthori[sz]ed\s+access|(?:your|account)\s+(?:account\s+)?(?:data|information|details)\s+(?:was|were|may\s+have\s+been|has\s+been)\s+(?:accessed|viewed|exposed|compromised))\b/i
const MARKETING = /\b\d+\s+(?:security\s+)?tips\b|\blearn\s+how\b|\bhow\s+to\s+avoid\b|%\s*off|\bdiscount\b|\bfree\s+trial\b|\bsubscribe\b|\bprotection\s+(?:plan|for\s+your)\b|\bwas\s+your\s+(?:data|email)\b|\bcheck\s+if\s+your\b|\bwebinar\b|\breport\s+20\d\d\b|\bwhitepaper\b/i
const ROUTINE = /\bif\s+(?:this|it)\s+was\s+you\b|\byou\s+don'?t\s+need\s+to\s+do\s+anything\b|\bno\s+(?:further\s+)?action\s+(?:is\s+)?(?:needed|required)\b|\bfrom\s+a\s+new\s+(?:device|browser|location)\b/i
/** A provider telling the person their own account or data was breached. Never marketing, a routine new-device
 *  notice, or a "verify now" link mail. This is the only security kind captured as an open loop. */
export function isSecurityBreachText(text: string): boolean {
  const t = String(text || '')
  return BREACH.test(t) && !MARKETING.test(t) && !ROUTINE.test(t) && !PHISHY.test(t)
}

export function isSecurityNoticeText(text: string): boolean {
  return isAccountAlertText(text) || isSecurityBreachText(text)
}

/** Links and domains are removed from what Gogo shows for a captured notice: open it from the mailbox, never a link. */
export function noticeDisplayText(text: string): string {
  return String(text || '').replace(/\bhttps?:\/\/\S+/gi, '[link removed]').replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|co|net|org|xyz|top|click|link|info|icu|buzz|io|ai|me|app)(?:\/\S*)?\b/gi, '[link removed]')
}
