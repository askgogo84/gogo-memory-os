import { supabaseAdmin } from '@/lib/supabase-admin'

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

    const { data: created, error } = await supabaseAdmin
      .from('users')
      .insert({
        telegram_id: fallbackTelegramId,
        whatsapp_id: externalUserId,
        name: userName || 'Friend',
        tier: 'free',
        platform: 'whatsapp',
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
    telegramId: user?.telegram_id,
    whatsappId: user?.whatsapp_id ?? externalUserId,
    name: user?.name || userName || 'Friend',
    tier: user?.tier || 'free',
    platform: 'whatsapp',
    rawUser: user,
  }
}

