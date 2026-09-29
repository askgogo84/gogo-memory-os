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

// "report X as spam/abuse/…" is unambiguously a provider mutation regardless of the
// noun in between (covers "report the status/post/listing as spam").
const REPORT_AS_MUTATION_RE =
  /\breport\b[^.!?;,]*\bas\s+(?:spam|abuse|abusive|inappropriate|offensive|fake|fraud|fraudulent|scam|harmful|harassment|violation|violating|misleading|counterfeit|objectionable)\b/i

// A benign reporting directive: "report back" or "report [qualifiers] <result-noun>".
const REPORTING_DIRECTIVE_SRC = `\\breport\\s+back\\b|\\breport(?:\\s+(?:${QUALIFIER}))*\\s+(?:${RESULT_NOUN})\\b`

/** True when `text` contains a benign reporting directive ("report only verified results"). */
export function containsReportingDirective(text: string): boolean {
  return new RegExp(REPORTING_DIRECTIVE_SRC, 'i').test(String(text || ''))
}

/** Remove reporting directives so downstream noun/intent checks don't see the word "report". */
export function stripReportingDirectives(text: string): string {
  return String(text || '').replace(new RegExp(REPORTING_DIRECTIVE_SRC, 'gi'), ' ')
}

/**
 * True when a clause-leading "report" is a provider MUTATION rather than a reporting
 * directive. Judged per occurrence so a benign trailing directive can never mask a
 * leading mutation ("report the seller … report only verified results").
 */
export function hasLeadingReportMutation(text: string): boolean {
  const t = String(text || '')
  if (REPORT_AS_MUTATION_RE.test(t)) return true
  const leading = new RegExp(
    `(?:^|[.!?;,]|\\b(?:and|then|to)\\b)\\s*(?:please\\s+)?report\\b(?!\\s+back\\b)(?!(?:\\s+(?:${QUALIFIER}))*\\s+(?:${RESULT_NOUN})\\b)`,
    'i',
  )
  return leading.test(t)
}
