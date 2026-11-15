/**
 * CreditIQ merchant-exact advisory ranking, deliberately disconnected from payment
 * authority. A stored card/points portfolio is NOT evidence of a usable offer.
 * This engine accepts only freshly sourced card- and cart-exact benefit quotes from
 * a future authenticated CreditIQ adapter; no offer => no recommendation.
 */
export type VerifiedCardBenefit = {
  owner: string
  cartSha256: string
  provider: string
  currency: 'INR'
  cardAlias: string
  offerId: string
  evidenceId: string
  evidenceSource: 'creditiq_issuer_verified'
  checkedAt: number
  expiresAt: number
  eligible: boolean
  estimatedBenefitPaise: number
  merchantFeePaise: number
  termsUrl: string | null
}

export type CardBenefitContext = {
  owner: string
  cartSha256: string
  provider: string
  totalPaise: number
  now?: number
}

export type CardBenefitRanking = {
  status: 'verified_offers' | 'insufficient_verified_evidence'
  suggestions: Array<{
    cardAlias: string
    offerId: string
    netEstimatedBenefitPaise: number
    evidenceId: string
    termsUrl: string | null
    guarantee: false
  }>
  disclaimer: string
}

const maxPaise = 5_000_000
const id = (v: unknown, size = 150): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= size && /^[\w. :/-]+$/.test(v)
const cents = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= maxPaise
const statement =
  'Card benefits are estimates based on recent, exact-merchant evidence. The issuer and merchant decide final eligibility. This does not select a payment card or authorize a charge.'

function safeTermsUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.search.length > 1000) return null
    // A terms URL is advisory, never an executable redirect or checkout.
    return u.toString()
  } catch { return null }
}

export function rankVerifiedCreditIQBenefits(
  ctx: CardBenefitContext, quotes: readonly VerifiedCardBenefit[],
): CardBenefitRanking {
  const empty: CardBenefitRanking = {status:'insufficient_verified_evidence',suggestions:[],disclaimer:statement}
  const now = ctx.now ?? Date.now()
  if (!id(ctx.owner) || !/^[0-9a-f]{64}$/.test(ctx.cartSha256) ||
    !id(ctx.provider, 50) || !cents(ctx.totalPaise) ||
    !Number.isFinite(now) || !Array.isArray(quotes) || quotes.length > 100) return empty
  const accepted = new Map<string, VerifiedCardBenefit>()
  for (const q of quotes) {
    if (q.owner !== ctx.owner || q.cartSha256 !== ctx.cartSha256 || q.provider !== ctx.provider ||
      q.currency !== 'INR' || q.evidenceSource !== 'creditiq_issuer_verified' || q.eligible !== true ||
      !id(q.cardAlias) || !id(q.offerId) || !id(q.evidenceId) ||
      !cents(q.estimatedBenefitPaise) || !cents(q.merchantFeePaise) ||
      q.estimatedBenefitPaise > ctx.totalPaise ||
      !Number.isFinite(q.checkedAt) || !Number.isFinite(q.expiresAt) ||
      q.checkedAt > now || now - q.checkedAt > 5 * 60_000 ||
      q.expiresAt <= now || q.expiresAt > q.checkedAt + 31 * 86400000 ||
      (q.termsUrl !== null && safeTermsUrl(q.termsUrl) === null)) continue
    const key = q.cardAlias + ':' + q.offerId
    const old = accepted.get(key)
    if (!old || q.checkedAt > old.checkedAt) accepted.set(key, q)
  }
  const suggestions = [...accepted.values()].map(q => ({
    cardAlias:q.cardAlias, offerId:q.offerId, evidenceId:q.evidenceId,
    netEstimatedBenefitPaise: Math.max(0, q.estimatedBenefitPaise-q.merchantFeePaise),
    termsUrl:safeTermsUrl(q.termsUrl), guarantee:false as const,
  })).filter(x => x.netEstimatedBenefitPaise > 0)
    .sort((a,b) => b.netEstimatedBenefitPaise-a.netEstimatedBenefitPaise || a.cardAlias.localeCompare(b.cardAlias))
    .slice(0,5)
  return {status:suggestions.length?'verified_offers':'insufficient_verified_evidence',suggestions,disclaimer:statement}
}
