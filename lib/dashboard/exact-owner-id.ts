// The dashboard session stores an owner ID as exact decimal TEXT. Do not convert
// it to a JS number before making a service-role authorization query: two
// distinct signed BIGINT owners can become the same IEEE-754 number.
// Project TypeScript target is ES2018; constructor calls work with the esnext
// library without introducing ES2020-only bigint literal syntax.
const MIN_BIGINT = BigInt('-9223372036854775808')
const MAX_BIGINT = BigInt('9223372036854775807')

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
