import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserTimeZone } from './handlers/user-timezone'
import { allocateWhatsAppOwnerId } from '@/lib/dashboard/owner-identity'

export type Channel = 'telegram' | 'whatsapp'

export type ResolvedUser = {
  id: string | number | null
  channel: Channel
  externalUserId: string
  telegramId: number
  whatsappId: string | null
  name: string
  tier: string
  isNewUser?: boolean
  platform: Channel
  timezone: string
  rawUser: any
}

// New owner IDs must never be derived from any phone-number substring.

export async function resolveUser(params: {
  channel: Channel
  externalUserId: string
  userName?: string
}) : Promise<ResolvedUser> {
  const { channel, externalUserId, userName } = params

  if (channel === 'telegram') {
    const telegramId = parseInt(externalUserId, 10)

    let { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single()

    if (!user) {
      const { data: created, error } = await supabaseAdmin
        .from('users')
        .insert({
          telegram_id: telegramId,
          name: userName || 'Friend',
          tier: 'free',
          platform: 'telegram',
          timezone: 'Asia/Kolkata',
          daily_count: 0,
          last_reset: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        })
        .select()
        .single()

      if (error) throw error
      user = created
    }

    return {
      id: user?.id ?? null,
      channel,
      externalUserId,
      telegramId,
      whatsappId: user?.whatsapp_id ?? null,
      name: user?.name || userName || 'Friend',
      tier: user?.tier || 'free',
      isNewUser: false,
      platform: 'telegram',
      timezone: getUserTimeZone(user, user?.whatsapp_id),
      rawUser: user,
    }
  }

  let { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('whatsapp_id', externalUserId)
    .single()

  if (!user) {
    const inferredTimezone = getUserTimeZone(null, externalUserId)
    // A fresh cryptographic ID has no phone-derived identity overlap. Retry only
    // Postgres uniqueness conflicts; all other failures remain fail-closed.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: created, error } = await supabaseAdmin
        .from('users')
        .insert({
          telegram_id: allocateWhatsAppOwnerId(),
          whatsapp_id: externalUserId,
          name: userName || 'Friend',
          tier: 'free',
          platform: 'whatsapp',
          timezone: inferredTimezone,
          daily_count: 0,
          last_reset: new Date().toLocaleDateString('en-CA', { timeZone: inferredTimezone }),
        })
        .select()
        .single()
      if (error) {
        if (error.code === '23505' && attempt < 3) continue
        throw error
      }
      if (!created) throw new Error('whatsapp_user_create_missing_row')
      user = created
      ;(user as any)._isNew = true
      break
    }
    if (!user) throw new Error('whatsapp_owner_id_allocation_failed')
  }

  return {
    id: user?.id ?? null,
    channel,
    externalUserId,
    telegramId: user?.telegram_id,
    whatsappId: user?.whatsapp_id ?? externalUserId,
    name: user?.name || userName || 'Friend',
    tier: user?.tier || 'free',
    isNewUser: !!(user as any)._isNew,
    platform: 'whatsapp',
    timezone: getUserTimeZone(user, externalUserId),
    rawUser: user,
  }
}
