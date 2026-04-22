import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchLatestEmails, refreshGmailAccessToken } from '@/lib/google-gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const telegramId = url.searchParams.get('telegramId')

  if (!telegramId) {
    return NextResponse.json({ ok: false, error: 'Missing telegramId' }, { status: 400 })
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
    .eq('telegram_id', Number(telegramId))
    .single()

  if (error || !user) {
    return NextResponse.json({ ok: false, stage: 'db_lookup', error: error?.message || 'User not found' }, { status: 404 })
  }

  let accessToken = user.gmail_access_token
  let refreshed = false

  if (!accessToken && user.gmail_refresh_token) {
    accessToken = await refreshGmailAccessToken(user.gmail_refresh_token)
    refreshed = true
  }

  if (!accessToken) {
    return NextResponse.json({
      ok: false,
      stage: 'token',
      gmail_connected: user.gmail_connected,
      has_access_token: !!user.gmail_access_token,
      has_refresh_token: !!user.gmail_refresh_token,
      gmail_email: user.gmail_email || null,
      error: 'No usable Gmail access token',
    })
  }

  try {
    const emails = await fetchLatestEmails(accessToken, 3)

    return NextResponse.json({
      ok: true,
      stage: 'fetch',
      gmail_connected: user.gmail_connected,
      gmail_email: user.gmail_email || null,
      has_access_token: !!user.gmail_access_token,
      has_refresh_token: !!user.gmail_refresh_token,
      refreshed,
      email_count: emails.length,
      emails,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      stage: 'fetch',
      gmail_connected: user.gmail_connected,
      gmail_email: user.gmail_email || null,
      has_access_token: !!user.gmail_access_token,
      has_refresh_token: !!user.gmail_refresh_token,
      refreshed,
      error: e?.message || 'Unknown Gmail fetch error',
    }, { status: 500 })
  }
}
