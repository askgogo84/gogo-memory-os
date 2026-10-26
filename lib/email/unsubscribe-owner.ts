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
  try {
    const n = BigInt(input)
    if (n === 0n || n < -(1n << 63n) || n > (1n << 63n) - 1n) return null
    return input
  } catch {
    return null
  }
}
