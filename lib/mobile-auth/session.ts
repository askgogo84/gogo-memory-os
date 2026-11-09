import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export type MobileActor = {
  userId: string
  legacyTelegramId: number
  whatsappId: string
  name: string
  platform: 'ios' | 'android'
  mobileSessionId: string
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export async function resolveMobileActor(request: Request): Promise<MobileActor | null> {
  const token = bearerFrom(request)
  if (!token || token.length < 32) return null
  try {
    const now = new Date().toISOString()

    const { data: session, error } = await supabaseAdmin
      .from('mobile_sessions')
      .select('id, user_id, platform, expires_at, revoked_at')
      .eq('session_token_hash', sha256(token))
      .is('revoked_at', null)
      .gt('expires_at', now)
      .maybeSingle()

    if (error || !session || !exactStoredId(session.id) || !exactStoredId(session.user_id)) return null
    if (session.revoked_at !== null || (session.platform !== 'ios' && session.platform !== 'android')) return null
    const expiresMs = typeof session.expires_at === 'string' ? Date.parse(session.expires_at) : NaN
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return null

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, telegram_id, whatsapp_id, name, access_status')
      .eq('id', session.user_id)
      .maybeSingle()

    if (userError || !user || user.id !== session.user_id || !exactStoredId(user.whatsapp_id)) return null
    if (user.access_status !== 'active' && user.access_status !== null) return null
    const legacyTelegramId = exactMobileOwnerId(user.telegram_id)
    if (legacyTelegramId === null) return null

    // Best effort only. Authentication must not fail because last_seen could not update.
    void (async () => {
      try {
        const { error: touchError } = await supabaseAdmin.from('mobile_sessions')
          .update({ last_seen_at: now }).eq('id', session.id).eq('user_id', session.user_id)
          .eq('session_token_hash', sha256(token)).is('revoked_at', null).gt('expires_at', now)
        if (touchError) console.error('MOBILE_SESSION_TOUCH_FAILED:', touchError.code)
      } catch {
        console.error('MOBILE_SESSION_TOUCH_FAILED')
      }
    })()

    return {
      userId: String(user.id),
      legacyTelegramId,
      whatsappId: String(user.whatsapp_id),
      name: user.name || 'Gogo',
      platform: session.platform as 'ios' | 'android',
      mobileSessionId: String(session.id),
    }
  } catch {
    // An unreadable bearer session/current owner is not authorization evidence.
    return null
  }
}

function exactStoredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

// The downstream actor contract is numeric. Deny identities it cannot carry losslessly.
function exactMobileOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value)
  if (!/^-?[1-9]\d*$/.test(raw)) return null
  const owner = Number(raw)
  return Number.isSafeInteger(owner) ? owner : null
}

export async function revokeMobileSession(request: Request): Promise<boolean> {
  const token = bearerFrom(request)
  if (!token) return false
  const { data, error } = await supabaseAdmin
    .from('mobile_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('session_token_hash', sha256(token))
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`mobile_session_revoke_failed:${error.message}`)
  return Boolean(data?.id)
}
