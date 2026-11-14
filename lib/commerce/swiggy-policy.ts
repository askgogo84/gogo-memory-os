// Swiggy Integration Agreement (effective 13 Nov 2026), clauses 4(iv) and 4(xi): while the agreement is in force,
// Swiggy content may not be used to gather competitive intelligence and the Swiggy site may not be scraped outside the
// agreement. Price comparisons that read swiggy.com (Swiggy food or Instamart) therefore stay off until Swiggy
// confirms in writing (asked 13 Nov). This does NOT decide clause 6 (exclusivity): comparisons that read only other
// platforms (Zomato, Zepto, Blinkit, Magicpin) keep running; whether that is acceptable is the owner's call.
// The operator sets COMMERCE_SWIGGY_COMPARISON_APPROVED=true only after Swiggy's written reply.

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
/** Reply when every store asked for was withheld (e.g. "price of butter on Instamart"). */
export const SWIGGY_ONLY_NOTE = SWIGGY_COMPARISON_NOTE + ' You can ask me to compare it on Zepto and Blinkit, or on Zomato for food.'
