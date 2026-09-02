import { createHmac, randomBytes, randomInt } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppAuthOtp } from '@/lib/whatsapp'

const OTP_TTL_MS = 5 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const OTP_ISSUE_LIMIT_PER_HOUR = 5
const OTP_RESEND_COOLDOWN_MS = 30 * 1000

function normalizePhone(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  const e164 = raw.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+91${digits}` : `+${digits}`
  return `whatsapp:${e164}`
}

function otpPepper(): string | null {
  return (process.env.DASHBOARD_OTP_PEPPER || '').trim() || null
}

function hashOtp(challengeId: string, otp: string): string | null {
  const pepper = otpPepper()
  if (!pepper) return null
  return createHmac('sha256', pepper).update(`${challengeId}:${otp}`).digest('hex')
}

function makeOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function makeChallengeId(): string {
  return randomBytes(18).toString('base64url')
}

export type OtpIssueResult =
  | { ok: true; challengeId: string; retryAfterSeconds: number }
  | { ok: false; reason: 'invalid' | 'throttled' | 'misconfigured' | 'error'; retryAfterSeconds?: number }

export async function issueDashboardOtp(phoneInput: string, requestIpHash?: string | null): Promise<OtpIssueResult> {
  const whatsappId = normalizePhone(phoneInput)
  if (!whatsappId) return { ok: false, reason: 'invalid' }
  if (!otpPepper()) {
    console.error('DASHBOARD_OTP_PEPPER_MISSING')
    return { ok: false, reason: 'misconfigured' }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentError } = await supabaseAdmin
    .from('dashboard_otp_challenges')
    .select('created_at')
    .eq('whatsapp_id', whatsappId)
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(OTP_ISSUE_LIMIT_PER_HOUR)

  if (recentError) {
    console.error('DASHBOARD_OTP_RATE_READ_FAILED:', recentError)
    return { ok: false, reason: 'error' }
  }

  if ((recent || []).length >= OTP_ISSUE_LIMIT_PER_HOUR) {
    return { ok: false, reason: 'throttled', retryAfterSeconds: 3600 }
  }

  const latestAt = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0
  const cooldownLeft = OTP_RESEND_COOLDOWN_MS - (Date.now() - latestAt)
  if (latestAt && cooldownLeft > 0) {
    return { ok: false, reason: 'throttled', retryAfterSeconds: Math.ceil(cooldownLeft / 1000) }
  }

  // Resolve only against an existing AskGogo WhatsApp identity. The endpoint
  // intentionally returns the same outward response whether this exists or not.
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id')
    .eq('whatsapp_id', whatsappId)
    .maybeSingle()

  if (userError) {
    console.error('DASHBOARD_OTP_USER_LOOKUP_FAILED:', userError)
    return { ok: false, reason: 'error' }
  }

  const challengeId = makeChallengeId()
  const otp = makeOtp()
  const otpHash = hashOtp(challengeId, otp)
  if (!otpHash) return { ok: false, reason: 'misconfigured' }

  const { error: insertError } = await supabaseAdmin
    .from('dashboard_otp_challenges')
    .insert({
      challenge_id: challengeId,
      whatsapp_id: whatsappId,
      telegram_id: user?.telegram_id != null ? String(user.telegram_id) : null,
      otp_hash: otpHash,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      request_ip_hash: requestIpHash || null,
    })

  if (insertError) {
    console.error('DASHBOARD_OTP_INSERT_FAILED:', insertError)
    return { ok: false, reason: 'error' }
  }

  // Unknown numbers get no message, but the caller receives the same generic
  // success shape so the login form cannot be used for account enumeration.
  if (user?.telegram_id != null) {
    try {
      await sendWhatsAppAuthOtp(whatsappId, otp)
    } catch (error) {
      console.error('DASHBOARD_OTP_SEND_FAILED:', error)
      return { ok: false, reason: 'error' }
    }
  }

  return { ok: true, challengeId, retryAfterSeconds: 30 }
}

export type OtpVerifyResult =
  | { ok: true; telegramId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'misconfigured' | 'error' }

export async function verifyDashboardOtp(challengeIdInput: string, otpInput: string): Promise<OtpVerifyResult> {
  const challengeId = String(challengeIdInput || '').trim()
  const otp = String(otpInput || '').replace(/\D/g, '').slice(0, 6)
  if (!challengeId || otp.length !== 6) return { ok: false, reason: 'invalid' }

  const expectedHash = hashOtp(challengeId, otp)
  if (!expectedHash) return { ok: false, reason: 'misconfigured' }

  const { data, error } = await supabaseAdmin
    .from('dashboard_otp_challenges')
    .select('challenge_id, telegram_id, otp_hash, expires_at, consumed_at, attempts')
    .eq('challenge_id', challengeId)
    .maybeSingle()

  if (error) {
    console.error('DASHBOARD_OTP_VERIFY_READ_FAILED:', error)
    return { ok: false, reason: 'error' }
  }
  if (!data || data.consumed_at) return { ok: false, reason: 'invalid' }
  if (new Date(data.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  if ((data.attempts ?? 0) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' }

  if (data.otp_hash !== expectedHash || !data.telegram_id) {
    const nextAttempts = (data.attempts ?? 0) + 1
    const { error: attemptError } = await supabaseAdmin
      .from('dashboard_otp_challenges')
      .update({ attempts: nextAttempts })
      .eq('challenge_id', challengeId)
      .is('consumed_at', null)
    if (attemptError) console.error('DASHBOARD_OTP_ATTEMPT_UPDATE_FAILED:', attemptError)
    return { ok: false, reason: nextAttempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid' }
  }

  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from('dashboard_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('challenge_id', challengeId)
    .is('consumed_at', null)
    .select('telegram_id')
    .maybeSingle()

  if (consumeError) {
    console.error('DASHBOARD_OTP_CONSUME_FAILED:', consumeError)
    return { ok: false, reason: 'error' }
  }
  if (!consumed?.telegram_id) return { ok: false, reason: 'invalid' }
  return { ok: true, telegramId: String(consumed.telegram_id) }
}
