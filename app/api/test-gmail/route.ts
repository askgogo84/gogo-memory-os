import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchLatestEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { isInternalServiceAuthorized } from '@/lib/security/cron-auth'
import { decryptGoogleToken, encryptGoogleToken } from '@/lib/security/google-token-crypto'

// PostgreSQL signed-64 owner IDs must remain exact before decrypting or reading a mailbox.
// Unsafe JavaScript numbers cannot prove identity even if they appear decimal.
function exactOwnerDecimal(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null
    value = String(value)
  }
  if (typeof value !== 'string' || !/^-?[1-9]\\d*$/.test(value)) return null
  try {
    const n = BigInt(value)
    if (n < -(1n << 63n) || n > (1n << 63n) - 1n) return null
    return value
  } catch { return null }
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  // 24 Oct: on a preview deployment this returned any user's latest emails for ?telegramId=. Now also needs the
  // internal Bearer secret, so a preview URL alone exposes nothing.
  if (!isInternalServiceAuthorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const rawTelegramId = url.searchParams.get('telegramId')
  if (!rawTelegramId) {
    return NextResponse.json({ ok: false, error: 'Missing telegramId' }, { status: 400 })
  }
  const telegramId = exactOwnerDecimal(rawTelegramId)
  if (!telegramId) {
    return NextResponse.json({ ok: false, error: 'invalid_telegram_id' }, { status: 400 })
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
    .eq('telegram_id', telegramId)
    .single()

  if (error || !user) {
    return NextResponse.json(
      { ok: false, stage: 'db_lookup', error: error?.message || 'User not found' },
      { status: 404 }
    )
  }

  // A wrong or imprecisely decoded returned owner is NOT authorization to decrypt
  // that user's Gmail tokens or call Google, even if the query looked owner-bound.
  if (exactOwnerDecimal(user.telegram_id) !== telegramId) {
    return NextResponse.json({ ok: false, stage: 'db_lookup', error: 'User not found' }, { status: 404 })
  }

  let accessToken = decryptGoogleToken(String(user.gmail_access_token || '')) || null
  let refreshed = false
  let emails: any[] = []

  if (accessToken) {
    try {
      emails = await fetchLatestEmails(accessToken, 3)
    } catch (error) {
      console.error('fetchLatestEmails with current token failed:', error)
    }
  }

  const refreshToken = decryptGoogleToken(String(user.gmail_refresh_token || ''))
  if (!emails.length && refreshToken) {
    const refreshedToken = await refreshGmailAccessToken(refreshToken)

    if (refreshedToken) {
      refreshed = true
      accessToken = refreshedToken

      await supabaseAdmin
        .from('users')
        .update({ gmail_access_token: encryptGoogleToken(refreshedToken) })
        .eq('telegram_id', telegramId)

      try {
        emails = await fetchLatestEmails(refreshedToken, 3)
      } catch (error) {
        console.error('fetchLatestEmails with refreshed token failed:', error)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    stage: 'refresh-debug',
    gmail_connected: user.gmail_connected,
    gmail_email: user.gmail_email || null,
    has_access_token: !!user.gmail_access_token,
    has_refresh_token: !!user.gmail_refresh_token,
    refreshed,
    email_count: emails.length,
    emails,
  })
}
