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

// Result/answer nouns a reporting directive reports back to the user.
const RESULT_NOUN =
  'results?|findings?|finding|status|information|info|details?|summary|summaries|prices?|costs?|availability|stock|answers?|answer|figures?|numbers?|readings?|outcomes?'

// Qualifiers (determiners, possessives, demonstratives, adverbs, adjectives) that may
// sit between "report" and the result noun. Determiners this/my/our/the are included
// because "report my results" / "report this information" are ordinary directives.
const QUALIFIER =
  'back|only|just|now|please|the|this|that|these|those|a|an|my|our|your|its|their|his|her|me|to|us|with|of|all|any|verified|unverified|actual|current|final|live|real|confirmed|exact|relevant|accurate|precise|available|latest|updated|complete|full|raw'

// A benign reporting directive: "report back" or "report [qualifiers] <result-noun>".
const DIRECTIVE_BODY = `report\\s+back\\b|report(?:\\s+(?:${QUALIFIER}))*\\s+(?:${RESULT_NOUN})\\b`
// The clause-leading boundary that marks "report" used as a verb (not inside a title).
const CLAUSE_LEAD = `(?:^|[.!?;,]|\\b(?:and|then|to)\\b)\\s*(?:please\\s+)?`

// Reasons that turn "report X as/for <reason>" into an unambiguous flag/abuse mutation.
const ABUSE_REASON =
  'spam|abuse|abusive|inappropriate|offensive|fake|fraud|fraudulent|scam|harmful|harassment|harassing|bullying|violation|violating|misleading|counterfeit|objectionable|nudity|violence|hate|impersonation|self[\\s-]?harm|misinformation'
// "report X as spam" / "report X for harassment" are always provider mutations,
// regardless of the noun in between (covers "report the status/post/listing …").
const REPORT_ABUSE_MUTATION_RE = new RegExp(
  `\\breport\\b[^.!?;,]*\\b(?:as|for)\\s+(?:${ABUSE_REASON})\\b`,
  'i',
)

/** Remove clause-leading reporting directives so downstream noun/intent checks don't see "report". */
export function stripReportingDirectives(text: string): string {
  // Anchored to a clause-leading "report" so a title where "report" is a NOUN
  // ("my hotel report summary") is left intact for the asset-noun escape.
  return String(text || '').replace(new RegExp(`${CLAUSE_LEAD}(?:${DIRECTIVE_BODY})`, 'gi'), ' ')
}

/**
 * True when a clause-leading "report" is a provider MUTATION rather than a reporting
 * directive. Judged per occurrence so a benign trailing directive can never mask a
 * leading mutation ("report the seller … report only verified results").
 */
export function hasLeadingReportMutation(text: string): boolean {
  const t = String(text || '')
  if (REPORT_ABUSE_MUTATION_RE.test(t)) return true
  const leading = new RegExp(
    `${CLAUSE_LEAD}report\\b(?!\\s+back\\b)(?!(?:\\s+(?:${QUALIFIER}))*\\s+(?:${RESULT_NOUN})\\b)`,
    'i',
  )
  return leading.test(t)
}
