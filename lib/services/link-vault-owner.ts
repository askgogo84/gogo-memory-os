/**
 * Link Vault's existing storage/service API accepts a JS number owner ID.
 * A 64-bit persisted telegram_id can distinguish 9007199254740992 from
 * 9007199254740993, but Number() aliases those distinct owners.
 *
 * Until the entire Link Vault service is migrated to exact decimal-string
 * owner IDs, fail closed BEFORE service-role reads, exports or imports.
 * This is an authorization boundary, not a cosmetic validator.
 */
export function safeNumericLinkVaultOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  // A persisted session owner is an exact identity, never display text to clean up.
  const raw = String(value)
  if (!/^-?[1-9][0-9]*$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || String(parsed) !== raw) return null
  return parsed
}
