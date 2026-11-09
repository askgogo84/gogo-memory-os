// Belt-and-braces redaction for the LLM prompt: keep secret-shaped memories out of the
// freeform Claude context (getMemories → askClaude). This is DEFENSE IN DEPTH, not the
// primary guarantee. The real guarantee is structural: vault plaintext is never written
// into public.memories, and no vault_items SELECT is added to the freeform assembly
// (see the constraint comment in process-message.ts). This filter only catches a secret
// that lands in `memories` anyway (e.g. a user pasting a password into "remember X").
//
// Kept pure and dependency-free so scripts/verify-memory-redaction.mts exercises the
// shipped logic directly.

// Explicit secret-labelling keywords. Matching any of these hides the whole memory.
const SECRET_KEYWORDS =
  /\b(pass(?:word|wd|code)|pin|otp|one[\s-]?time[\s-]?password|passport|aadhaar|aadhar|ssn|cvv|cvc|card\s*number|account\s*number|credit\s*card|debit\s*card|api[\s_-]?key|secret\s*key|secret|security\s*code|routing\s*number|ifsc)\b/i

// Sensitive values that may appear in conversation history. Keep this deliberately
// conservative: it is only a prompt-boundary redactor, not a parser for the source data.
// Explicit credential/account labels always outrank the international-phone exemption,
// including values beginning with +, '+ 91', or a parenthesized +country code.
const LABELED_SECRET_VALUE_RE =
  /\b(pass(?:word|wd|code)|pin|otp|one[\s-]?time[\s-]?password|passport(?:\s*(?:number|no))?|aadhaar|aadhar|ssn|cvv|cvc|(?:credit\s*|debit\s*)?card\s*number|(?:credit\s*|debit\s*)card|account\s*(?:number|no\.?)|api[\s_-]?key|secret\s*key|security\s*code|routing\s*number|ifsc)\b\s*(?:is|:|=|-)?\s*(\(?\+?\s*[A-Z0-9][A-Z0-9\s._\-/()]{2,})/gi

// 3 Nov (Gogo): "all phone numbers to be seen, so that we can make the calls easily". Business numbers in search
// results ("Tel No : 080 2310 3567", "+91 98450 12345") were withheld as long digit runs, and calling a salon needs
// them. A number written as a phone is shown: it starts with a +country code, or it comes right after a phone word.
// Unlabelled long digit runs (card, account and Aadhaar shapes) stay withheld, and the labelled pass already hides
// anything called an account, card or passport number before this runs.
const PHONE_LABEL = /\b(?:tel(?:ephone)?|ph(?:one)?|mob(?:ile)?|cell|call(?:\s+us)?(?:\s+on)?|contact(?:\s+us)?|whats\s?app|landline|helpline|hotline|reach\s+us|phone\s+number|mobile\s+number|contact\s+number|book(?:ings?)?\s+(?:at|on|via)|reservations?|reserve\s+(?:at|on)|dial)\s*(?:no\.?|number|#)?\s*(?:[:.\-–]|is)?\s*(?:at|on)?\s*\(?$/i
export function isPhoneNumber(value: string, before: string): boolean {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 13) return false
  const lead = String(before || '').slice(-40)
  if (/\+\s?$/.test(lead)) return true
  // 4 Nov (retest): salon results list numbers with no label ("Envi Salon · 080 4123 4567 · 4.5★"). Indian phone
  // layouts are shown on their own: a 0-prefixed STD landline (080 4123 4567) or a mobile split 5+5 (98450 12345).
  // Card (4-4-4-4) and Aadhaar (4-4-4, never starting 0) groupings don't fit either shape, so they stay hidden.
  const v = String(value || '').trim()
  if (/^0\d{2,4}[\s-]\d{3,4}[\s-]?\d{3,4}$/.test(v) && digits.length >= 10 && digits.length <= 12) return true
  if (/^0?[6-9]\d{4}[\s-]\d{5}$/.test(v)) return true
  if (/(?:📞|☎️?|📱)\s*$/u.test(lead)) return true
  return PHONE_LABEL.test(lead)
}

// Heuristic: does this memory look like it carries a credential/identifier we must not
// surface to the model?
//   - keyword match (labelled secrets), OR
//   - a long digit run: 8+ consecutive digits after stripping spaces/hyphens, which
//     catches card / account / passport-style numbers (e.g. "4111 1111 1111 1111").
//
// FALSE POSITIVES (acceptable): a benign note that merely mentions "password", or a
// 10-digit phone number, gets withheld from Claude — the memory still exists, Claude
// just won't see it that turn. FALSE NEGATIVES (why this is belt-and-braces, not the
// guarantee): a short unlabelled secret (e.g. a 4-digit PIN with no "pin" word, or a
// passport like "A1234567" that is <8 digits) can still slip through.
export function isSecretShapedMemory(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  if (!text) return false
  if (SECRET_KEYWORDS.test(text)) return true
  // A phone number written as one (see isPhoneNumber) is not an identifier to hide.
  const withoutPhones = text.replace(/\+?\b(?:\d[\s-]?){8,}\b/g, (value, offset: number) =>
    isPhoneNumber(value, text.slice(0, offset) + (value.startsWith('+') ? '+' : '')) ? ' ' : value)
  const digitsOnly = withoutPhones.replace(/[\s-]/g, '')
  if (/\d{8,}/.test(digitsOnly)) return true
  return false
}

// Redact sensitive VALUE spans while preserving the surrounding conversational turn.
// This is used at the final freeform prompt boundary so old assistant replies containing
// passport/account/etc. values cannot be re-fed to the LLM and echoed on a later turn.
export function redactSecretShapedText(content: string): string {
  if (!content) return content
  let out = String(content)

  // Preserve the label/context and replace only its value.
  // 18 Oct live: "my passport expires in March 2028" became "my passport [sensitive detail withheld]" (the /i
  // flag let any word count as a value). Only an identifier-shaped value — with a digit, not a sentence about
  // dates — is withheld.
  out = out.replace(LABELED_SECRET_VALUE_RE, (match, label, value) => {
    const v = String(value || '')
    const sentence = /\b(?:expires?|expiry|expired|valid|renew(?:al|ed)?|issued|until|till|due|in|on|from|at)\b/i.test(v.split(/\s+/).slice(0, 2).join(' '))
    // Passwords, OTPs, keys and security codes are always withheld. Identifier labels (card, account, passport,
    // Aadhaar, PIN) need an identifier-shaped value: 6 Nov live, "check your bank/credit card statements" became
    // "credit card [sensitive detail withheld]".
    if (/^(?:pass(?:word|wd|code)|otp|one[\s-]?time|api|secret|security|cvv|cvc)/i.test(String(label))) return `${label} [sensitive detail withheld]`
    return /\d/.test(v) && !sentence ? `${label} [sensitive detail withheld]` : match
  })

  // Generated authenticated report links carry UUIDs, whose first group can be
  // all digits. Preserve only these exact first-party routes, never arbitrary
  // URLs, query values or fragments, so redaction cannot break the saved result.
  const reportLinks = [...out.matchAll(/https:\/\/[^\s<>)\]]+/gi)].filter(match => {
    try {
      const url = new URL(match[0])
      return url.hostname === 'app.askgogo.in' && !url.username && !url.password && !url.port && !url.search && !url.hash
        && /^\/dashboard\/(?:comparisons|activity)\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}(?:\/browser)?$/i.test(url.pathname)
    } catch { return false }
  })
  // Catch long unlabelled identifier-like digit runs that survived the labelled pass.
  // A calendar date (2026-10-17) is 8 digits too, but not an identifier: 12 Oct, the booking
  // planner never saw the requested date because it was withheld here.
  out = out.replace(/\b(?:\d[\s-]?){8,}\b/g, (value, offset: number) =>
    reportLinks.some(link => offset >= link.index! && offset + value.length <= link.index! + link[0].length)
      || /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value.trim())
      || isPhoneNumber(value, out.slice(0, offset))
      // 6 Nov live: 'Payment order successful - 6856147904' (a CCAvenue order number) was withheld. An order,
      // invoice, booking, PNR, tracking or reference number is the detail the person needs; only unlabelled runs
      // and card/account/ID labels stay hidden.
      // Only a contiguous run: "2345 6789 0123" in groups is card- or account-shaped and stays hidden.
      || (!/[\s-]/.test(value.trim())
        && /\b(?:order|invoice|booking|pnr|tracking|awb|shipment|reference|txn|transaction|utr|receipt|ticket|consignment|docket)\b[^\d\n]{0,30}$/i.test(out.slice(Math.max(0, offset - 40), offset))
        && !/\b(?:account|a\/c|card|aadhaar|pan|passport|ifsc|cvv|pin|otp|mobile|phone)\b/i.test(out.slice(Math.max(0, offset - 40), offset)))
      ? value : '[sensitive detail withheld]')

  return out
}

// Drop every secret-shaped entry. Exported for reuse/testing alongside getMemories.
export function stripSecretShapedMemories(memories: string[]): string[] {
  return memories.filter((m) => !isSecretShapedMemory(m))
}
