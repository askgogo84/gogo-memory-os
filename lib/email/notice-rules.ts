// Pure text rules shared by the attention scorer and the open-loop notice capture (no imports, so sandboxed
// harnesses and both callers judge the same way).

/** Service about to be cut off. 13 Nov comparison: WeWork's "access and keycards deactivate around 3pm tomorrow if
 *  the ₹35,841.29 dues aren't settled" matched neither "payment failed" nor "suspend", so Gogo never saw it. */
export function isServiceCutoffText(text: string): boolean {
  const t = String(text || '')
  const failed = /\b(?:payment\s+(?:failed|declined)|billing\s+(?:failed|overdue)|overdue\s+invoice)\b/i.test(t)
    && /\b(?:shutdown|shut\s*down|suspend(?:ed|ing)?|suspension|service\s+interruption|action\s+required|disconnect)\b/i.test(t)
  const dues = /\b(?:dues?|outstanding|unpaid|overdue|pending\s+(?:amount|payment|dues)|balance\s+(?:due|outstanding))\b/i.test(t)
    && /\b(?:deactivat(?:e|ed|es|ion)|disconnect(?:ed|ion)?|terminat(?:e|ed|ion)|suspend(?:ed|ing)?|suspension|(?:access|keycards?|account|service)\s+(?:will\s+be\s+|to\s+be\s+|is\s+being\s+)?(?:revoked|removed|disabled|blocked|deactivated|cut\s+off|stopped))\b/i.test(t)
  return failed || dues
}

/** A security notice about the person's own account. 13 Nov comparison: Apify's breach notice ("your account data was
 *  viewed") was dropped as automated mail. Generic advice ("5 security tips") is not a notice. */
export function isSecurityNoticeText(text: string): boolean {
  const t = String(text || '')
  if (/\b(?:tips?|webinar|guide|best practices|how to|report 20\d\d|whitepaper)\b/i.test(t)) return false
  return /\b(?:suspicious|unusual)\s+(?:sign[- ]?in|login|activity)\b|\bpassword (?:was )?changed\b|\baccount (?:locked|compromised)\b/i.test(t)
    || /\b(?:security\s+(?:incident|breach)|data\s+breach|unauthori[sz]ed\s+access|(?:your|account)\s+(?:account\s+)?(?:data|information|details)\s+(?:was|were|may have been|has been)\s+(?:accessed|viewed|exposed|compromised))\b/i.test(t)
}

