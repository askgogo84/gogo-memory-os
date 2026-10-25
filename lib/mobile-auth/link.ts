import { createHash, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

const LINK_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function randomCode(length = 8) {
  const bytes = randomBytes(length)
  let value = ''
  for (let i = 0; i < length; i++) value += CROCKFORD[bytes[i] % CROCKFORD.length]
  return value
}

export function normalizeMobileLinkCode(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/^GOGO[-\s]?/i, '')
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

function displayCode(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}`
}

export function parseMobileLinkCommand(text: string): string | null {
  const match = String(text || '').trim().match(/^(?:link|connect|pair)\s+(?:gogo[-\s]?)?([a-z0-9-]{8,16})$/i)
  if (!match) return null
  const code = normalizeMobileLinkCode(match[1])
  return code.length === 8 ? code : null
}

export async function createMobileLinkRequest(params: {
  platform: 'ios' | 'android'
  deviceId?: string | null
  deviceName?: string | null
}) {
  const code = randomCode(8)
  const pollToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()

  const { data, error } = await supabaseAdmin
    .from('mobile_link_requests')
    .insert({
      code_hash: sha256(normalizeMobileLinkCode(code)),
      poll_token_hash: sha256(pollToken),
      platform: params.platform,
      device_id: String(params.deviceId || '').slice(0, 160) || null,
      device_name: String(params.deviceName || '').slice(0, 160) || null,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (error || !data?.id) throw new Error(`mobile_link_create_failed:${error?.message || 'unknown'}`)

  const shownCode = displayCode(code)
  return {
    linkId: String(data.id),
    code: shownCode,
    pollToken,
    expiresAt,
    whatsappMessage: `LINK ${shownCode}`,
  }
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

export async function approveMobileLink(params: {
  code: string
  userId: string
  whatsappId: string
}) {
  const now = new Date().toISOString()
  const hash = sha256(normalizeMobileLinkCode(params.code))
  const { data, error } = await supabaseAdmin
    .from('mobile_link_requests')
    .update({
      status: 'approved',
      user_id: params.userId,
      whatsapp_id: params.whatsappId,
      approved_at: now,
    })
    .eq('code_hash', hash)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`mobile_link_approve_failed:${error.message}`)
  return Boolean(data?.id)
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
