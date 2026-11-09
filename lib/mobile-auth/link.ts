import { createHash, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

// The WhatsApp "LINK <code>" device-code pairing (createMobileLinkRequest / parseMobileLinkCommand /
// approveMobileLink) was retired in red #1171: nothing ever approved those codes and the parser misread text such as
// "connect calendar". What remains is shared by the WhatsApp OTP sign-in flow (lib/mobile-auth/otp.ts), which writes
// mobile_link_requests rows that the app polls and exchanges for a session.
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function getMobileLinkStatus(pollToken: string) {
  const hash = sha256(String(pollToken || ''))
  const { data, error } = await supabaseAdmin
    .from('mobile_link_requests')
    .select('id, status, expires_at, approved_at')
    .eq('poll_token_hash', hash)
    .maybeSingle()

  if (error) throw new Error(`mobile_link_status_failed:${error.message}`)
  if (!data) return { status: 'not_found' as const }

  if (new Date(data.expires_at).getTime() <= Date.now() && data.status === 'pending') {
    await supabaseAdmin.from('mobile_link_requests').update({ status: 'expired' }).eq('id', data.id)
    return { status: 'expired' as const }
  }

  return {
    status: data.status as 'pending' | 'approved' | 'exchanged' | 'expired',
    approvedAt: data.approved_at || null,
    expiresAt: data.expires_at,
  }
}

export async function exchangeMobileLink(params: {
  pollToken: string
  platform: 'ios' | 'android'
  deviceId?: string | null
  deviceName?: string | null
}) {
  const accessToken = randomBytes(32).toString('base64url')
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const { data, error } = await supabaseAdmin.rpc('mobile_exchange_link', {
    p_poll_token_hash: sha256(String(params.pollToken || '')),
    p_session_token_hash: sha256(accessToken),
    p_platform: params.platform,
    p_device_id: String(params.deviceId || '').slice(0, 160),
    p_device_name: String(params.deviceName || '').slice(0, 160),
    p_session_expires_at: sessionExpiresAt,
  })

  if (error) throw new Error(`mobile_link_exchange_failed:${error.message}`)
  if (!data) return null

  return {
    accessToken,
    sessionId: String(data),
    expiresAt: sessionExpiresAt,
  }
}
