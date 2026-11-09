/**
 * Dashboard browser-run entry points bridge a persisted TEXT owner identity
 * to older browser workers accepting only numeric actors.
 *
 * Refuse noncanonical/unsafe numeric identities before ANY privileged lookup,
 * Vault credential inspection, request-body read or browser continuation.
 * Do not restore access via phone suffix matching or rounded BIGINT values.
 */
export type BrowserRunOwner = { telegramId: string; legacyTelegramId: number }

export function browserRunOwnerFromSession(raw: unknown): BrowserRunOwner | null {
  if (typeof raw !== 'string' || !/^-?[1-9][0-9]*$/.test(raw)) return null
  const legacyTelegramId = Number(raw)
  if (!Number.isSafeInteger(legacyTelegramId) || legacyTelegramId === 0 ||
      String(legacyTelegramId) !== raw) return null
  return { telegramId: raw, legacyTelegramId }
}

/** Ensure the service-role user row is the exact identity authenticated by the session. */
export function browserRunOwnerMatchesRow(value: unknown, owner: BrowserRunOwner): boolean {
  if (typeof value === 'string') return value === owner.telegramId
  if (typeof value === 'bigint') return value === BigInt(owner.telegramId)
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    String(value) === owner.telegramId
}
