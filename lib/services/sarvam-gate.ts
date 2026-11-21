// Who a Sarvam switch applies to (21 Nov). Before this, five of the six switches were global: "on" meant every user.
//
// A switch is used for a request only when ALL of these hold:
//   1. the switch is "on", the key is present, and in production GOGO_SARVAM_PRODUCTION=approved (unchanged base gate);
//   2. the person this request serves is known (the metering context every surface sets), and
//   3. that person's id is listed in GOGO_SARVAM_USERS (comma-separated ids; no wildcard).
// Unknown person, empty list or unset list means the existing provider is used. Nothing here grants any permission:
// it only chooses which model answers, and every approval gate downstream is untouched.
//
// GOGO_SARVAM_BRAIN applies the same list, on top of the brain's own canary (brainEnabledFor). That canary lists phones in
// GOGO_BRAIN_USERS and may include people other than the owner, so the brain needs the list too (review, 21 Nov).
//
// Pure: no Supabase, no provider import. Ids are compared as strings and never converted to a number.
import { currentMeterContext } from '../metering/core'

type Env = Record<string, string | undefined>

/** The base gate, exactly as shipped in #1548. */
export const sarvamBaseEnabled = (flag: string, env: Env = process.env) =>
  env[flag] === 'on' && !!env.SARVAM_API_KEY &&
  (env.VERCEL_ENV !== 'production' || env.GOGO_SARVAM_PRODUCTION === 'approved')

/** Ids allowed to be served by Sarvam. Only plain ids (digits, optional leading minus, or a uuid); "*" and "all" are not ids. */
export function sarvamAllowlist(env: Env = process.env): Set<string> {
  return new Set(String(env.GOGO_SARVAM_USERS || '').split(',').map(s => s.trim()).filter(s => /^-?\d{3,20}$/.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s)).slice(0, 200))
}

/** Whether this Sarvam switch applies to the person this request serves. `who` defaults to the metering context. */
export function sarvamEnabled(flag: string, env: Env = process.env, who: string | number | null | undefined = currentMeterContext()?.telegramId): boolean {
  if (!sarvamBaseEnabled(flag, env)) return false
  const id = who == null ? '' : String(who).trim()
  return !!id && sarvamAllowlist(env).has(id)
}
