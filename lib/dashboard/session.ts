import { createHash, createHmac, randomBytes } from 'crypto'
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

// ── Typed one-time code ───────────────────────────────────────────────────────
// Alongside the magic link we mint a short, human-typable code so a user who
// can't tap the link (wrong device, copy-paste mangling) can still get in. It
// lives on the SAME dashboard_tokens row as the token and is stored only as
// sha256 of its normalised form.
//
// Crockford base32 alphabet — deliberately omits I, L, O, U (the glyphs people
// confuse or that spell things). 256 is an exact multiple of 32, so `byte % 32`
// is unbiased; no rejection sampling needed.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 8

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CROCKFORD_ALPHABET[bytes[i] % 32]
  return code
}

// 4-4 display form. The redeem form and the normaliser both strip the hyphen, so
// "ABCD-EFGH" and "ABCDEFGH" hash identically and redeem the same.
function hyphenate(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

// Normalisation MUST be byte-for-byte identical on issue and redeem, or a code
// minted one way won't match when typed back. Uppercase → strip whitespace and
// hyphens → fold the Crockford aliases I/L→1 and O→0. Generated codes never
// contain I/L/O, so the fold only ever repairs a user's typo.
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

function hashCode(code: string): string {
  return sha256(normalizeCode(code))
}

export type IssueResult =
  | { ok: true; token: string; code: string }
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
  const code = generateCode()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  const { error: insertError } = await supabaseAdmin
    .from('dashboard_tokens')
    // Token and code minted on ONE row, in ONE insert — same telegram_id, same
    // TTL, same used_at gate. Redeeming either burns the row for both.
    .insert({
      telegram_id: tg,
      token_hash: sha256(token),
      code_hash: hashCode(code),
      expires_at: expiresAt,
    })

  if (insertError) {
    console.error('DASHBOARD_TOKEN_INSERT_FAILED:', insertError)
    return { ok: false, reason: 'error' } // fail closed
  }
  return { ok: true, token, code: hyphenate(code) }
}

// Burn a credential row by its hash, returning the telegram_id (TEXT) or null.
// Single atomic conditional UPDATE: used_at is set in the same statement that
// reads the row, gated on `used_at is null and expires_at > now()`. Two concurrent
// taps race on the row lock; Postgres re-evaluates the WHERE for the loser, so
// exactly one update succeeds and only one session can ever be minted.
//
// The hash is matched against BOTH columns (token_hash OR code_hash) so ONE
// statement serves both the magic-link and the typed-code path. A token's hash
// can only ever equal a token_hash and a code's only a code_hash (different
// preimages), so the OR never cross-matches. Zero rows back — invalid, expired,
// or already used — all return null; the difference only helps an attacker.
//
// INVARIANT — the ONLY callers are redeemToken (sha256 of the token) and
// redeemCode (sha256 of the normalised code). `hash` is therefore ALWAYS a
// 64-char sha256 hex string, NEVER raw user input. That is what makes the
// `.or()` string interpolation below safe (hex has no PostgREST filter
// metacharacters). If you add a caller, it MUST pass sha256 hex too — do not
// widen this to interpolate anything user-supplied.
async function burnCredential(hash: string): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('dashboard_tokens')
    .update({ used_at: nowIso })
    // Safe interpolation: `hash` is sha256 hex only (see INVARIANT above).
    .or(`token_hash.eq.${hash},code_hash.eq.${hash}`)
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

// Magic-link path: hash the raw token and burn.
export function redeemToken(token: string): Promise<string | null> {
  return burnCredential(sha256(token))
}

// Typed-code path: normalise (identically to issue) then hash and burn.
export function redeemCode(code: string): Promise<string | null> {
  return burnCredential(hashCode(code))
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

// ── Redeem throttle ───────────────────────────────────────────────────────────
// Per-IP lockout on the /dashboard code-redeem endpoint, to blunt online brute
// force of the 8-char code. The ~1.1e12 code space is the real defence; this is
// belt-and-braces. Tunables (20 attempts / 15-min window / 15-min lockout) live
// in Postgres — loosened from 10 because Indian carrier-grade NAT pools many
// users behind one IP. Keyed by an HMAC of the client IP under a server pepper;
// we NEVER store a bare IP hash.

// Peppered IP hash, or null if DASHBOARD_THROTTLE_PEPPER is unset. Read with NO
// fallback: a missing pepper MUST fail closed at the caller (refuse the redeem),
// never degrade to a bare hash. Empty IP folds to a shared 'unknown' bucket
// rather than a per-request key.
export function hashIp(ip: string): string | null {
  const pepper = process.env.DASHBOARD_THROTTLE_PEPPER
  if (!pepper) {
    console.error('DASHBOARD_THROTTLE_PEPPER_MISSING')
    return null
  }
  return createHmac('sha256', pepper).update(ip || 'unknown').digest('hex')
}

// True when this ip_hash is currently locked. THROWS on a store error so the
// caller can fail closed — a throttle we can't read must not become one we ignore.
export async function isRedeemLocked(ipHash: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('dashboard_redeem_throttle')
    .select('locked_until')
    .eq('ip_hash', ipHash)
    .maybeSingle()
  if (error) {
    console.error('DASHBOARD_REDEEM_THROTTLE_READ_FAILED:', error)
    throw new Error('throttle_read_failed')
  }
  if (!data?.locked_until) return false
  return new Date(data.locked_until).getTime() > Date.now()
}

// Register one failed redeem. The RPC owns the attempt-count → locked_until
// arithmetic in Postgres. Best-effort: a logged error here never changes the
// generic failure the user already sees.
export async function registerRedeemFail(ipHash: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('dashboard_redeem_register_fail', { p_ip_hash: ipHash })
  if (error) console.error('DASHBOARD_REDEEM_REGISTER_FAIL_RPC_FAILED:', error)
}

// Clear the throttle row after a successful redeem. Best-effort — a stale row
// just costs the user a few attempts next time; it never blocks the session.
export async function clearRedeemThrottle(ipHash: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('dashboard_redeem_throttle')
    .delete()
    .eq('ip_hash', ipHash)
  if (error) console.error('DASHBOARD_REDEEM_THROTTLE_CLEAR_FAILED:', error)
}
