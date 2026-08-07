import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Dashboard auth core ───────────────────────────────────────────────────────
// The ONLY way into the dashboard is a WhatsApp-issued magic link: single-use,
// 15-minute TTL, its token stored only as a SHA-256 hash so a leaked
// dashboard_tokens table yields no working links. A redeemed token mints a
// server-side session; the cookie carries a random id, never the telegram_id.
//
// telegram_id is TEXT in dashboard_tokens / dashboard_sessions (and the meter
// tables), always String()'d at this boundary. reminders/users store it as
// bigint/numeric — callers cast back with parseInt when they cross into those
// tables. Those tables are NOT changed by this track.

const TOKEN_TTL_MS = 15 * 60 * 1000 // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const ISSUE_LIMIT_PER_HOUR = 5

export const SESSION_COOKIE = 'askgogo_session'
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000)

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export type IssueResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'throttled' | 'error' }

// Issue a magic-link token for a telegram_id. Rate-limited to 5 issues per hour
// by counting this user's recent rows in dashboard_tokens (the table already has
// a (telegram_id, created_at desc) index for exactly this). FAILS CLOSED: if the
// count can't be read, or the insert fails, we refuse to mint a token — a token
// is a credential, so "couldn't verify" must never resolve to "here's a link".
export async function issueToken(telegramId: string | number): Promise<IssueResult> {
  const tg = String(telegramId)

  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabaseAdmin
    .from('dashboard_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', tg)
    .gte('created_at', sinceIso)

  if (countError) {
    console.error('DASHBOARD_TOKEN_COUNT_FAILED:', countError)
    return { ok: false, reason: 'error' } // fail closed
  }
  if ((count ?? 0) >= ISSUE_LIMIT_PER_HOUR) {
    return { ok: false, reason: 'throttled' }
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  const { error: insertError } = await supabaseAdmin
    .from('dashboard_tokens')
    .insert({ telegram_id: tg, token_hash: sha256(token), expires_at: expiresAt })

  if (insertError) {
    console.error('DASHBOARD_TOKEN_INSERT_FAILED:', insertError)
    return { ok: false, reason: 'error' } // fail closed
  }
  return { ok: true, token }
}

// Redeem a token, returning the telegram_id (TEXT) or null. The burn is a single
// atomic conditional UPDATE: used_at is set in the same statement that reads the
// row, gated on `used_at is null and expires_at > now()`. Two concurrent taps
// race on the row lock; Postgres re-evaluates the WHERE for the loser, so exactly
// one update succeeds and only one session can ever be minted. Zero rows back —
// invalid, expired, or already used — all return null; the difference only helps
// an attacker.
export async function redeemToken(token: string): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('dashboard_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', sha256(token))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('telegram_id')
    .maybeSingle()

  if (error) {
    console.error('DASHBOARD_TOKEN_REDEEM_FAILED:', error)
    return null
  }
  if (!data) return null
  return String(data.telegram_id)
}

// Create a session row for a redeemed telegram_id and return its random id (the
// cookie value). 32 random bytes, base64url — carries no user information.
export async function createSession(telegramId: string): Promise<string | null> {
  const sessionId = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const { error } = await supabaseAdmin
    .from('dashboard_sessions')
    .insert({ session_id: sessionId, telegram_id: String(telegramId), expires_at: expiresAt })

  if (error) {
    console.error('DASHBOARD_SESSION_CREATE_FAILED:', error)
    return null
  }
  return sessionId
}

// Resolve the current session from the cookie. Returns { telegramId } (TEXT) or
// null. The telegram_id is ONLY ever obtained here, by session-id lookup — never
// from a URL, query string, or the cookie's contents.
export async function getSession(): Promise<{ telegramId: string } | null> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return null

  const { data, error } = await supabaseAdmin
    .from('dashboard_sessions')
    .select('telegram_id, expires_at')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error || !data) return null
  if (new Date(data.expires_at).getTime() <= Date.now()) return null
  return { telegramId: String(data.telegram_id) }
}

// Sign out: DELETE the session row, not just the cookie. Clearing the cookie
// alone would leave a valid session behind that a saved link could ride back in
// on. Cookie clearing itself is done by the caller (route handler).
export async function endSession(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return

  const { error } = await supabaseAdmin
    .from('dashboard_sessions')
    .delete()
    .eq('session_id', sessionId)

  if (error) console.error('DASHBOARD_SESSION_DELETE_FAILED:', error)
}
