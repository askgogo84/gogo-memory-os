import { NextRequest, NextResponse } from 'next/server'
import { getGmailAuthUrl, verifyGmailConnectToken } from '@/lib/google-gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const telegramId = verifyGmailConnectToken(token)

  if (!telegramId) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired connection link' },
      { status: 401 }
    )
  }

  const authUrl = getGmailAuthUrl(telegramId)
  if (!authUrl) {
    console.error('GMAIL_OAUTH_STATE_SECRET_MISSING')
    return NextResponse.json(
      { ok: false, error: 'Google connection is temporarily unavailable' },
      { status: 503 }
    )
  }

  return NextResponse.redirect(authUrl)
}
