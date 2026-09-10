import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentSession } from './session'

export type AgentActor = {
  userId: string
  legacyTelegramId: number
  whatsappId: string
  name: string
  creditiqUserId: string | null
}

export async function resolveAgentActor(session: AgentSession): Promise<AgentActor> {
  let query = supabaseAdmin
    .from('users')
    .select('id, telegram_id, whatsapp_id, name')

  if (session.userId) query = query.eq('id', session.userId)
  else query = query.eq('telegram_id', Number(session.telegramId))

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`agent_actor_lookup_failed:${error.message}`)
  if (!data) throw new Error('agent_actor_not_found')

  const whatsappId = String(data.whatsapp_id || session.whatsappId || '').trim()
  if (!whatsappId) throw new Error('whatsapp_identity_required')
  const legacyTelegramId = Number(data.telegram_id)
  if (!Number.isFinite(legacyTelegramId)) throw new Error('legacy_identity_missing')

  // CreditIQ linkage is deliberately best-effort. The AskGogo actor keeps only
  // the opaque CreditIQ consumer id; card/account data remains inside CreditIQ.
  // A missing link must never block ordinary Gogo missions.
  let creditiqUserId: string | null = null
  try {
    const { data: link, error: linkError } = await supabaseAdmin
      .from('wa_creditiq_links')
      .select('consumer_user_id')
      .eq('sender', whatsappId)
      .maybeSingle()
    if (linkError) console.error('agent_actor_creditiq_link_lookup_failed:', linkError.message)
    else if (link?.consumer_user_id) creditiqUserId = String(link.consumer_user_id)
  } catch (linkError) {
    console.error('agent_actor_creditiq_link_lookup_failed:', linkError)
  }

  return {
    userId: String(data.id),
    legacyTelegramId,
    whatsappId,
    name: String(data.name || 'Gogo'),
    creditiqUserId,
  }
}
