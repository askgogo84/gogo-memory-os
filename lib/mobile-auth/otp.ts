import { createHash, randomInt, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'

const OTP_TTL_MS = 10 * 60 * 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function normalizeWhatsappLogin(value: string): string | null {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return `+${digits}`
}

function otpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export async function startWhatsappOtpLink(params: {
  whatsappNumber: string
  platform: 'ios' | 'android'
  deviceId?: string | null
  deviceName?: string | null
}) {
  const normalized = normalizeWhatsappLogin(params.whatsappNumber)
  if (!normalized) throw new Error('invalid_whatsapp_number')

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabaseAdmin
    .from('mobile_link_requests')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_id', normalized)
    .gte('created_at', since)
  if (countError) throw new Error('link_rate_check_failed')
  if ((count || 0) >= 4) throw new Error('too_many_codes')

  const candidates = [normalized, normalized.slice(1)]
  const { data: users, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, whatsapp_id')
    .in('whatsapp_id', candidates)
    .limit(1)
  if (userError) throw new Error('user_lookup_failed')
  const user = users?.[0] || null

  const code = otpCode()
  const pollToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()
  const { data: link, error: insertError } = await supabaseAdmin
    .from('mobile_link_requests')
    .insert({
      code_hash: sha256(code),
      poll_token_hash: sha256(pollToken),
      platform: params.platform,
      device_id: String(params.deviceId || '').slice(0, 160) || null,
      device_name: String(params.deviceName || '').slice(0, 160) || null,
      user_id: user?.id || null,
      whatsapp_id: normalized,
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (insertError || !link?.id) throw new Error('link_create_failed')

  if (user?.id) {
    try {
      await sendWhatsAppMessage(
        normalized,
        `🔐 *AskGogo app verification*\n\nYour code is *${code}*\n\nIt expires in 10 minutes and can be used once. If you didn't request this, ignore this message.`,
      )
    } catch (error: any) {
      console.error('MOBILE_OTP_WHATSAPP_DELIVERY_FAILED:', error?.message || error)
      await supabaseAdmin.from('mobile_link_requests').update({ status: 'expired' }).eq('id', link.id)
      // Do not disclose whether the number was an AskGogo account.
    }
  }

  return {
    linkId: String(link.id),
    pollToken,
    expiresAt,
    message: 'If this WhatsApp number is linked to AskGogo, Gogo has sent a 6-digit verification code.',
  }
}

export async function verifyWhatsappOtpLink(params: { pollToken: string; code: string }) {
  const code = String(params.code || '').replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) return false
  const { data, error } = await supabaseAdmin.rpc('mobile_verify_link', {
    p_poll_token_hash: sha256(String(params.pollToken || '')),
    p_code_hash: sha256(code),
  })
  if (error) throw new Error(`mobile_otp_verify_failed:${error.message}`)
  return data === true
}
