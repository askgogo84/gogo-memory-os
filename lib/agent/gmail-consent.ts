// Gmail consent (4 Nov P1 hotfix, owner decision: "connecting Gmail = yes"). Gmail is read only when
// user_consent_settings.gmail_enabled is true. Connecting Gmail (Google sign-in or the Composio link) is the
// affirmative act that saves it. An explicit "off" is never overridden by a reconnect.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type ConsentResult = 'saved' | 'already_on' | 'kept_off'

export async function recordGmailConnectConsent(telegramId: string | number): Promise<ConsentResult> {
  if (typeof telegramId === 'number' && !Number.isSafeInteger(telegramId)) throw new Error('owner_identity_invalid:unsafe_number')
  const tg = String(telegramId ?? '').trim()
  if (!/^-?(?:0|[1-9]\d{0,18})$/.test(tg)) throw new Error('owner_identity_invalid:format')
  const { data, error } = await supabaseAdmin.from('user_consent_settings').select('gmail_enabled').eq('telegram_id', tg).maybeSingle()
  if (error) throw new Error(`gmail_consent_read_failed:${error.message}`)
  if (data?.gmail_enabled === false) return 'kept_off'
  if (data?.gmail_enabled === true) return 'already_on'
  if (data) {
    const { error: e } = await supabaseAdmin.from('user_consent_settings').update({ gmail_enabled: true }).eq('telegram_id', tg).is('gmail_enabled', null)
    if (e) throw new Error(`gmail_consent_write_failed:${e.message}`)
  } else {
    const { error: e } = await supabaseAdmin.from('user_consent_settings').upsert({ telegram_id: tg, gmail_enabled: true }, { onConflict: 'telegram_id', ignoreDuplicates: true })
    if (e) throw new Error(`gmail_consent_write_failed:${e.message}`)
  }
  return 'saved'
}
