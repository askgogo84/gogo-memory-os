// Connected-memory canary (29 Oct review): the memory front door and stay ingestion run only for the owners on the
// canary list, never for every production user just because a list exists or the deploy is production. Pure.

/** The owner's two test numbers: the production default when GOGO_BRAIN_USERS is unset. */
export const OWNER_CANARY = '8884501501,8310441698'

// Match the whole number, not its last ten digits (a 10-digit list entry means +91).
const digits = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d }

/** On for the phones in GOGO_BRAIN_USERS (default on production: OWNER_CANARY); GOGO_MEMORY=off turns it off for everyone. */
export function memoryEnabledFor(phone: unknown, env: Record<string, string | undefined> = (globalThis as any).process?.env || {}): boolean {
  if (String(env.GOGO_MEMORY || '').toLowerCase() === 'off') return false
  const list = String(env.GOGO_BRAIN_USERS || (env.VERCEL_ENV === 'production' ? OWNER_CANARY : ''))
  const me = digits(phone)
  return !!me && list.split(',').map(digits).filter(Boolean).includes(me)
}
