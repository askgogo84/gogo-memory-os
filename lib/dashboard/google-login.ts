import { createHash, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

const STATE_TTL_MS = 10 * 60 * 1000
const CALLBACK_URL = 'https://app.askgogo.in/api/dashboard/google/callback'

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export type GoogleMode = 'login' | 'link'

export async function issueGoogleState(mode: GoogleMode, telegramId?: string | null): Promise<string | null> {
  const state = randomBytes(32).toString('base64url')
  const { error } = await supabaseAdmin.from('dashboard_google_oauth_states').insert({
    state_hash: sha256(state),
    mode,
    telegram_id: telegramId || null,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  })
  if (error) {
    console.error('DASHBOARD_GOOGLE_STATE_INSERT_FAILED:', error.message)
    return null
  }
  return state
}

export async function consumeGoogleState(state: string): Promise<{ mode: GoogleMode; telegramId: string | null } | null> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('dashboard_google_oauth_states')
    .update({ used_at: now })
    .eq('state_hash', sha256(state))
    .is('used_at', null)
    .gt('expires_at', now)
    .select('mode, telegram_id')
    .maybeSingle()
  if (error || !data) return null
  return { mode: data.mode as GoogleMode, telegramId: data.telegram_id ? String(data.telegram_id) : null }
}

export function buildGoogleDashboardAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleDashboardCode(code: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    })
    const json = await res.json()
    return res.ok && json.access_token ? String(json.access_token) : null
  } catch (err) {
    console.error('DASHBOARD_GOOGLE_TOKEN_EXCHANGE_FAILED:', err)
    return null
  }
}

export async function fetchGoogleIdentity(accessToken: string): Promise<{ sub: string; email: string } | null> {
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    const json = await res.json()
    if (!res.ok || !json.sub || !json.email || json.email_verified !== true) return null
    return { sub: String(json.sub), email: String(json.email).toLowerCase() }
  } catch (err) {
    console.error('DASHBOARD_GOOGLE_USERINFO_FAILED:', err)
    return null
  }
}

export async function findTelegramIdForGoogle(identity: { sub: string; email: string }): Promise<string | null> {
  const { data: mapped } = await supabaseAdmin
    .from('dashboard_google_identities')
    .select('telegram_id')
    .eq('google_sub', identity.sub)
    .maybeSingle()
  if (mapped?.telegram_id) return String(mapped.telegram_id)

  // Safe auto-link only for an email previously verified by Gmail OAuth.
  const { data: gmailMatches } = await supabaseAdmin
    .from('users')
    .select('telegram_id')
    .eq('gmail_connected', true)
    .ilike('gmail_email', identity.email)
    .limit(2)
  if ((gmailMatches || []).length !== 1 || !gmailMatches?.[0]?.telegram_id) return null

  const telegramId = String(gmailMatches[0].telegram_id)
  const { error } = await supabaseAdmin.from('dashboard_google_identities').insert({
    google_sub: identity.sub,
    telegram_id: telegramId,
    email: identity.email,
    last_login_at: new Date().toISOString(),
  })
  if (error) return null
  return telegramId
}

export async function linkGoogleIdentity(telegramId: string, identity: { sub: string; email: string }): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('dashboard_google_identities')
    .select('telegram_id')
    .eq('google_sub', identity.sub)
    .maybeSingle()
  if (existing?.telegram_id && String(existing.telegram_id) !== String(telegramId)) return false

  const { data: currentForUser } = await supabaseAdmin
    .from('dashboard_google_identities')
    .select('google_sub')
    .eq('telegram_id', String(telegramId))
    .maybeSingle()
  if (currentForUser?.google_sub && currentForUser.google_sub !== identity.sub) return false

  const { error } = await supabaseAdmin.from('dashboard_google_identities').upsert({
    google_sub: identity.sub,
    telegram_id: String(telegramId),
    email: identity.email,
    last_login_at: new Date().toISOString(),
  }, { onConflict: 'google_sub' })
  return !error
}

export async function touchGoogleLogin(sub: string): Promise<void> {
  await supabaseAdmin
    .from('dashboard_google_identities')
    .update({ last_login_at: new Date().toISOString() })
    .eq('google_sub', sub)
}
