import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminPhone } from '@/lib/bot/handlers/admin-analytics'
import { exactAdminOwnerId } from '@/lib/admin/console-auth'

export type AdminSession =
  | { ok: true; telegramId: string; whatsappId: string; status?: never; reason?: never }
  | { ok: false; status: 401 | 403; reason: 'unauthenticated' | 'invalid_session' | 'user_lookup_failed' | 'not_admin' }

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getSession()
  if (!session) return { ok: false, status: 401, reason: 'unauthenticated' }

  const telegramId = exactAdminOwnerId(session.telegramId)
  if (!telegramId) {
    return { ok: false, status: 403, reason: 'invalid_session' }
  }

  let data: { telegram_id: unknown; whatsapp_id?: string | null } | null
  try {
    const result = await supabaseAdmin.from('users').select('telegram_id, whatsapp_id').eq('telegram_id', telegramId).maybeSingle()
    if (result.error) {
      console.error('ADMIN_AUTH_USER_LOOKUP_FAILED:', result.error.code || 'db_error')
      return { ok: false, status: 403, reason: 'user_lookup_failed' }
    }
    data = result.data
  } catch { return { ok: false, status: 403, reason: 'user_lookup_failed' } }
  if (!data || exactAdminOwnerId(data.telegram_id) !== telegramId) return { ok: false, status: 403, reason: 'user_lookup_failed' }

  const whatsappId = String(data?.whatsapp_id || '')
  if (!whatsappId || !isAdminPhone(whatsappId)) {
    return { ok: false, status: 403, reason: 'not_admin' }
  }

  return { ok: true, telegramId, whatsappId }
}

