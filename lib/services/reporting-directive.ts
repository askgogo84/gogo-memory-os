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

// Qualifiers between "report" and the result noun. Demonstratives (this/that/these/
// those) are allowed before a PURE result ("report this information") but NOT before a
// WEAK one, where a demonstrative signals a provider object ("report this status").
const QUALIFIER =
  'back|only|just|now|please|the|this|that|these|those|a|an|my|our|your|its|their|his|her|me|to|us|with|of|all|any|verified|unverified|actual|current|final|live|real|confirmed|exact|relevant|accurate|precise|available|latest|updated|complete|full|raw'
const SAFE_QUAL = // QUALIFIER minus demonstratives
  'back|only|just|now|please|the|a|an|my|our|your|its|their|his|her|me|to|us|with|of|all|any|verified|unverified|actual|current|final|live|real|confirmed|exact|relevant|accurate|precise|available|latest|updated|complete|full|raw'

const ABUSE_REASON =
  'spam|abuse|abusive|inappropriate|offensive|fake|fraud|fraudulent|scam|harmful|harassment|harassing|bullying|violation|violating|misleading|counterfeit|objectionable|nudity|violence|hate|impersonation|self[\\s-]?harm|misinformation'

// The clause-leading boundary that marks "report" used as a verb (not a noun inside a
// title). Leading adverbs ("only report …") are part of the verb phrase.
const CLAUSE_LEAD = `(?:^|[.!?;,]|\\b(?:and|then|to)\\b)\\s*(?:(?:please|kindly|only|just|now|also|then)\\s+)*`

// A WEAK-result directive is benign only when it is NOT immediately flagged
// "as/for <abuse reason>" ("report the status for harassment" is a mutation).
const WEAK_NOT_ABUSE = `(?!(?:\\s+\\w+){0,3}\\s+(?:as|for)\\s+(?:${ABUSE_REASON})\\b)`

// Benign reporting-directive body (the part after the clause-leading boundary).
const DIRECTIVE_BODY =
  `report\\s+back\\b` +
  `|report(?:\\s+(?:${QUALIFIER}))*\\s+(?:${PURE_RESULT})\\b` +
  `|report(?:\\s+(?:${SAFE_QUAL}))*\\s+(?:${WEAK_RESULT})\\b${WEAK_NOT_ABUSE}`

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
      `(?!(?:\\s+(?:${QUALIFIER}))*\\s+(?:${PURE_RESULT})\\b)` +
      `(?!(?:\\s+(?:${SAFE_QUAL}))*\\s+(?:${WEAK_RESULT})\\b${WEAK_NOT_ABUSE})`,
    'i',
  )
  return leading.test(String(text || ''))
}
