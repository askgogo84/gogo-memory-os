import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentSession } from './session'

export type AgentActor = {
  userId: string
  legacyTelegramId: number
  whatsappId: string
  name: string
  creditiqUserId?: string | null
  timezone?: string
}

// AgentActor's legacyTelegramId is a JavaScript number. Reject every ID that
// cannot round-trip exactly before using it for a service-role owner lookup
// or downstream actor operations. Never alias two distinct Postgres BIGINTs.
function exactSafeTelegramId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value !== 0 ? String(value) : null
  if (typeof value !== 'string' || !/^-?[1-9]\\d*$/.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && String(numeric) === value ? value : null
}

export async function resolveAgentActor(session: Omit<AgentSession,'surface'> & {surface:AgentSession['surface']|'whatsapp'}): Promise<AgentActor> {
  const sessionOwner = exactSafeTelegramId(session.telegramId)
  if (!sessionOwner) throw new Error('agent_actor_invalid_session_owner')
  let query = supabaseAdmin
    .from('users')
    .select('id, telegram_id, whatsapp_id, name, timezone')

  if (session.userId) query = query.eq('id', session.userId)
  else query = query.eq('telegram_id', sessionOwner)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`agent_actor_lookup_failed:${error.message}`)
  if (!data) throw new Error('agent_actor_not_found')

  const whatsappId = String(data.whatsapp_id || session.whatsappId || '').trim()
  if (!whatsappId) throw new Error('whatsapp_identity_required')
  const storedOwner = exactSafeTelegramId(data.telegram_id)
  if (!storedOwner) throw new Error('legacy_identity_unsafe')
  if (storedOwner !== sessionOwner) throw new Error('agent_actor_identity_mismatch')
  const legacyTelegramId = Number(storedOwner)

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
    timezone: String(data.timezone || 'Asia/Kolkata'),
  }
}

