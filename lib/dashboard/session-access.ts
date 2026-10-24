/**
 * A dashboard cookie authenticates a session identifier, not the current right to use an account.
 * Resolve only the session's persisted, exact telegram_id user row on every request.
 * No phone-suffix guesses or cross-account linking are authorization proofs.
 */
export type DashboardSessionUser = { access_status?: string | null }
export type DashboardSessionUserResult = { data: DashboardSessionUser | null; error?: unknown }

export function exactDashboardOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value)
  if (!/^-?[1-9]\d*$/.test(raw)) return null
  const number = Number(raw)
  return Number.isSafeInteger(number) ? number : null
}

/**
 * Fail closed on revoked, deleted, unresolvable, ambiguous, or unreadable owner rows.
 * Historical users with a null access_status are still allowed; only a persisted
 * explicit "blocked" status revokes an otherwise valid user row.
 */
export async function dashboardAccountIsActive(
  telegramId: unknown,
  readUser: (id: number) => Promise<DashboardSessionUserResult>,
): Promise<boolean> {
  const id = exactDashboardOwnerId(telegramId)
  if (id === null) return false
  try {
    const result = await readUser(id)
    if (result?.error || !result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) return false
    return result.data.access_status !== 'blocked'
  } catch {
    return false
  }
}
