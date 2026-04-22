import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'

export const dynamic = 'force-dynamic'

async function gmailFetch(accessToken: string, url: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

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
    return NextResponse.json(
      { ok: false, stage: 'db_lookup', error: error?.message || 'User not found' },
      { status: 404 }
    )
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

  const inboxList = await gmailFetch(
    accessToken,
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3&labelIds=INBOX'
  )

  const firstId = inboxList?.data?.messages?.[0]?.id || null

  let firstMessage = null
  let firstMessageMeta = null

  if (firstId) {
    firstMessage = await gmailFetch(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstId}`
    )

    firstMessageMeta = await gmailFetch(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstId}?format=metadata`
    )
  }

  return NextResponse.json({
    ok: true,
    stage: 'debug-one-message',
    gmail_connected: user.gmail_connected,
    gmail_email: user.gmail_email || null,
    has_access_token: !!user.gmail_access_token,
    has_refresh_token: !!user.gmail_refresh_token,
    refreshed,
    inboxList,
    firstId,
    firstMessage,
    firstMessageMeta,
  })
}
