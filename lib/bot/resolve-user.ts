import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserTimeZone } from './handlers/user-timezone'

export type Channel = 'telegram' | 'whatsapp'

export type ResolvedUser = {
  id: string | number | null
  channel: Channel
  externalUserId: string
  telegramId: number
  whatsappId: string | null
  name: string
  tier: string
  platform: Channel
  timezone: string
  rawUser: any
}

function generateNegativeTelegramId(phone: string): number {
  const digits = phone.replace(/\D/g, '').slice(-9) || '999999999'
  const numeric = parseInt(digits, 10)
  return -1 * numeric
}

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
    const fallbackTelegramId = generateNegativeTelegramId(externalUserId)
    const inferredTimezone = getUserTimeZone(null, externalUserId)

    const { data: created, error } = await supabaseAdmin
      .from('users')
      .insert({
        telegram_id: fallbackTelegramId,
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

    if (error) throw error
    user = created
  }

  return {
    id: user?.id ?? null,
    channel,
    externalUserId,
    telegramId: user?.telegram_id,
    whatsappId: user?.whatsapp_id ?? externalUserId,
    name: user?.name || userName || 'Friend',
    tier: user?.tier || 'free',
    platform: 'whatsapp',
    timezone: getUserTimeZone(user, externalUserId),
    rawUser: user,
  }
}

