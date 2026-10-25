// Shared "reporting directive" recognition.
//
// The user appends a directive such as "Report only verified results." to almost
// every explicit browser command. That is an instruction to Gogo about HOW to
// answer — it is neither a provider mutation (report a seller/post/status as spam)
// nor a request to retrieve a saved "report" document. Two independent routers were
// tripped by the bare word "report":
//   • parseConnectedProviderReadCommand (WhatsApp secure-browser preflight)
//   • shouldAttemptNaturalAssetRetrieval (Asset Memory operational-flow guard)
// Keeping the grammar in one place stops the two copies from drifting apart.

// PURE result nouns are only ever the thing Gogo reports back — never a provider
// object. A directive built on them is always benign ("report my results", even
// "report results for harassment prevention" where the abuse word is a purpose).
const PURE_RESULT =
  'results?|findings?|finding|information|info|summary|summaries|answers?|answer|figures?|numbers?|readings?|outcomes?|details?|data'
// WEAK result nouns double as provider objects on social sites (a "status"/"price"
// post/attribute). "report the status" (order status) is benign, but "report this
// status" (demonstrative → object) and "report the status for harassment" (abuse
// suffix) are mutations.
const WEAK_RESULT = 'status|prices?|costs?|availability|stock'

// Reasons that turn "report <weak object> as/for <reason>" into a flag/abuse mutation.
// Necessarily non-exhaustive — it is a preflight signal, not the final safety gate
// (the secure browser runs read-only and any consequential action needs approval).
const ABUSE_REASON =
  'spam|abuse|abusive|inappropriate|offensive|fake|fraud|fraudulent|scam|harmful|harassment|harassing|bullying|violation|violating|misleading|counterfeit|objectionable|nudity|violence|violent|hate|hateful|impersonation|self[\\s-]?harm|misinformation|disinformation|terrorism|terrorist|extremis(?:m|t)|weapons?|drugs?|illegal|csam|exploitation|phishing|threats?|doxx?ing|incitement|defamation|infringement|copyright|graphic|sexual|racism|racist'

// The clause-leading boundary that marks "report" used as a verb (not a noun inside a
// title). Leading adverbs ("only report …") are part of the verb phrase.
const CLAUSE_LEAD = `(?:^|[.!?;,]|\\b(?:and|then|to)\\b)\\s*(?:(?:please|kindly|only|just|now|also|then)\\s+)*`

// Bounded arbitrary modifiers between "report" and the result noun. Any adjective/
// determiner is allowed ("the matching verified results"), but the run stops at a
// clause joint, an "as/for" flag suffix, or an object-introducing preposition
// (with/about/regarding/…) so it cannot bridge over a mutation object and reach a
// trailing result noun ("report the seller with these details" stays a mutation).
const MOD_STOP = 'and|then|but|or|as|for|to|with|about|regarding|concerning|against|over'
const PURE_MOD = `(?:\\s+(?!(?:${MOD_STOP})\\b)[a-z0-9'-]+){0,6}`
// WEAK modifiers additionally exclude demonstratives: "report this status" targets a
// provider object, not an order status attribute.
const WEAK_MOD = `(?:\\s+(?!(?:${MOD_STOP}|this|that|these|those)\\b)[a-z0-9'-]+){0,6}`
// A WEAK-result directive is benign only when it is NOT flagged "as/for <abuse reason>"
// ("report the status for harassment" is a mutation).
const WEAK_NOT_ABUSE = `(?!(?:\\s+[a-z0-9'-]+){0,3}\\s+(?:as|for)\\s+(?:${ABUSE_REASON})\\b)`

// Benign reporting-directive body (the part after the clause-leading boundary).
const DIRECTIVE_BODY =
  `report\\s+back\\b` +
  `|report${PURE_MOD}\\s+(?:${PURE_RESULT})\\b` +
  `|report${WEAK_MOD}\\s+(?:${WEAK_RESULT})\\b${WEAK_NOT_ABUSE}`

/** Remove clause-leading reporting directives so downstream noun/intent checks don't see "report". */
export function stripReportingDirectives(text: string): string {
  // Anchored to a clause-leading "report" so a title where "report" is a NOUN
  // ("my hotel report summary") is left intact for the asset-noun escape.
  return String(text || '').replace(new RegExp(`${CLAUSE_LEAD}(?:${DIRECTIVE_BODY})`, 'gi'), ' ')
}

/**
 * True when a clause-leading "report" is a provider MUTATION rather than a reporting
 * directive. A leading "report" is a mutation unless it is "report back" or a benign
 * PURE/WEAK result directive. Judged per occurrence so a benign trailing directive can
 * never mask a leading mutation ("report the seller … report only verified results").
 */
export function hasLeadingReportMutation(text: string): boolean {
  const leading = new RegExp(
    `${CLAUSE_LEAD}report\\b` +
      `(?!\\s+back\\b)` +
      `(?!${PURE_MOD}\\s+(?:${PURE_RESULT})\\b)` +
      `(?!${WEAK_MOD}\\s+(?:${WEAK_RESULT})\\b${WEAK_NOT_ABUSE})`,
    'i',
  )
  return leading.test(String(text || ''))
}
