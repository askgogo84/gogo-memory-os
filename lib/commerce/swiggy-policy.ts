// Swiggy Integration Agreement (effective 13 Nov 2026), clauses 4(iv), 4(xi) and 6: while the agreement is in force,
// Swiggy content may not be used to gather competitive intelligence, the Swiggy site may not be scraped outside the
// agreement, and AskGogo may not build a similar solution with another food, dining-out or quick-commerce platform.
// Price comparisons that read swiggy.com (Swiggy food or Instamart) therefore stay off until Swiggy confirms in
// writing (asked 13 Nov). The operator sets COMMERCE_SWIGGY_COMPARISON_APPROVED=true only after that written reply.

export const SWIGGY_COMPARISON_PROVIDERS = ['swiggy', 'instamart'] as const

export function swiggyComparisonApproved(): boolean {
  return process.env.COMMERCE_SWIGGY_COMPARISON_APPROVED === 'true'
}

/** Providers that must be left out of a comparison right now. Pure apart from the env flag. */
export function withheldComparisonProviders<T extends string>(providers: readonly T[]): T[] {
  if (swiggyComparisonApproved()) return []
  return providers.filter(p => (SWIGGY_COMPARISON_PROVIDERS as readonly string[]).includes(p))
}

export const SWIGGY_COMPARISON_NOTE = 'Swiggy and Instamart are left out of price comparisons for now, so I did not check them.'
