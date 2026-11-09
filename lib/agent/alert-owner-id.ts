/** Canonical persisted Telegram BIGINT owner for private alert/briefing operations.
 *
 * Never use Number(text) to authorize a service-role row: distinct 64-bit IDs can
 * become the same IEEE-754 integer. Mobile auth currently passes a numeric
 * legacyTelegramId, so deny mobile unsafe-range owners until that actor
 * contract has a lossless string ID.
 */
const MIN_SIGNED_BIGINT = BigInt('-9223372036854775808')
const MAX_SIGNED_BIGINT = BigInt('9223372036854775807')

export function exactAlertOwnerId(
  value: unknown,
  surface: 'web' | 'ios' | 'android' = 'web',
): string | null {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return null
  const text = String(value)
  if (!/^-?[1-9]\d*$/.test(text)) return null
  try {
    const owner = BigInt(text)
    if (owner < MIN_SIGNED_BIGINT || owner > MAX_SIGNED_BIGINT) return null
    // MobileActor.legacyTelegramId is currently number: never authorize its rounded bigint.
    if (surface !== 'web' && !Number.isSafeInteger(Number(text))) return null
    return text
  } catch {
    return null
  }
}
