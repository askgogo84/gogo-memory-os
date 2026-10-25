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
  const now = new Date().toISOString()

  const { data: session, error } = await supabaseAdmin
    .from('mobile_sessions')
    .select('id, user_id, platform, expires_at, revoked_at')
    .eq('session_token_hash', sha256(token))
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle()

  if (error || !session?.user_id) return null

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, telegram_id, whatsapp_id, name')
    .eq('id', session.user_id)
    .maybeSingle()

  if (userError || !user?.id || !user?.whatsapp_id || !Number.isFinite(Number(user.telegram_id))) return null

  // Best effort only. Authentication must not fail because last_seen could not update.
  supabaseAdmin.from('mobile_sessions').update({ last_seen_at: now }).eq('id', session.id).then(({ error: touchError }) => {
    if (touchError) console.error('MOBILE_SESSION_TOUCH_FAILED:', touchError.message)
  })

  return {
    userId: String(user.id),
    legacyTelegramId: Number(user.telegram_id),
    whatsappId: String(user.whatsapp_id),
    name: user.name || 'Gogo',
    platform: session.platform as 'ios' | 'android',
    mobileSessionId: String(session.id),
  }
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
