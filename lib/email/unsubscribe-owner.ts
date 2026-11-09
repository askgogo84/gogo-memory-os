/**
 * A signed email link contains a persisted BIGINT owner identity, not a JS number.
 * Keep the canonical 64-bit decimal string for the PostgREST owner predicate:
 * Number("9007199254740993") aliases the different owner 9007199254740992.
 *
 * Legacy negative identities are supported; malformed/overflowing IDs fail closed.
 * Signature verification and the exact email predicate remain separate requirements.
 */
export function exactUnsubscribeOwnerId(input: unknown): string | null {
  if (typeof input !== 'string' || !/^-?[1-9]\d{0,18}$/.test(input)) return null
  // String magnitude comparisons are exact and work with the repo's pre-ES2020 TS target.
  // The preceding regex rejects sign/zero/leading-zero ambiguity and limits to 19 digits.
  const negative = input[0] === '-'
  const digits = negative ? input.slice(1) : input
  const bound = negative ? '9223372036854775808' : '9223372036854775807'
  if (digits.length === bound.length && digits > bound) return null
  return input
}
