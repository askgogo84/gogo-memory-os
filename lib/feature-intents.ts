// AskGogo Feature Intent Router
// Existing deterministic routing remains byte-for-byte in feature-intents-legacy.
// Muse-style Agent handling runs ONLY when legacy routing declines the turn.

import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { tryRunWhatsAppAgent } from '@/lib/agent/whatsapp-bridge'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ResolvedUser } from '@/lib/bot/resolve-user'

export async function routeFeatureIntent(
  phone: string,
  text: string,
  extra?: { telegramId?: number; caption?: string },
): Promise<string | null> {
  const legacy = await routeLegacyFeatureIntent(phone, text, extra)
  if (legacy) return legacy
  if (!extra?.telegramId) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id,telegram_id,whatsapp_id,name,tier,timezone,platform')
      .eq('telegram_id', extra.telegramId)
      .maybeSingle()
    if (error) {
      console.error('WHATSAPP_AGENT_USER_LOOKUP_FAILED:', error.message)
      return null
    }
    if (!data?.id) return null

    const user: ResolvedUser = {
      id: data.id,
      channel: 'whatsapp',
      externalUserId: phone,
      telegramId: Number(data.telegram_id),
      whatsappId: String(data.whatsapp_id || phone),
      name: String(data.name || 'Friend'),
      tier: String(data.tier || 'free'),
      platform: 'whatsapp',
      timezone: String(data.timezone || 'Asia/Kolkata'),
      rawUser: data,
    }

    const agent = await tryRunWhatsAppAgent({ user, text })
    return agent?.text || null
  } catch (err: any) {
    // Agent enhancement must never break the mature WhatsApp fallback path.
    console.error('WHATSAPP_AGENT_BRIDGE_FAILED:', err?.message || err)
    return null
  }
}
