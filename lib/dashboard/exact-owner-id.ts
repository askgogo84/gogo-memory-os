// The dashboard session stores an owner ID as exact decimal TEXT. Do not convert
// it to a JS number before making a service-role authorization query: two
// distinct signed BIGINT owners can become the same IEEE-754 number.
const MIN_BIGINT = -(1n << 63n)
const MAX_BIGINT = (1n << 63n) - 1n

export function exactDashboardOwnerId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:[1-9]\d*|-[1-9]\d*)$/.test(value)) return null
  try {
    const parsed = BigInt(value)
    if (parsed < MIN_BIGINT || parsed > MAX_BIGINT) return null
    return value
  } catch {
    return null
  }
}
