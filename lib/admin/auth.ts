import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminPhone } from '@/lib/bot/handlers/admin-analytics'

export type AdminSession =
  | { ok: true; telegramId: string; whatsappId: string }
  | { ok: false; status: 401 | 403; reason: 'unauthenticated' | 'invalid_session' | 'user_lookup_failed' | 'not_admin' }

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getSession()
  if (!session) return { ok: false, status: 401, reason: 'unauthenticated' }

  const telegramId = String(session.telegramId || '').trim()
  const numericTelegramId = Number(telegramId)
  if (!telegramId || !Number.isFinite(numericTelegramId)) {
    return { ok: false, status: 403, reason: 'invalid_session' }
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('whatsapp_id')
    .eq('telegram_id', numericTelegramId)
    .maybeSingle()

  if (error) {
    console.error('ADMIN_AUTH_USER_LOOKUP_FAILED:', error)
    return { ok: false, status: 403, reason: 'user_lookup_failed' }
  }

  const whatsappId = String(data?.whatsapp_id || '')
  if (!whatsappId || !isAdminPhone(whatsappId)) {
    return { ok: false, status: 403, reason: 'not_admin' }
  }

  return { ok: true, telegramId, whatsappId }
}
