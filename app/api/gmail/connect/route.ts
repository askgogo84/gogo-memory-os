import { NextRequest, NextResponse } from 'next/server'
import { getGmailAuthUrl, verifyGmailConnectToken } from '@/lib/google-gmail'
import { newOauthBinding, setBindingCookie } from '@/lib/security/oauth-browser-binding'

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

  // Bind the OAuth state to this browser (OAuth CSRF fix).
  const binding = newOauthBinding()
  const authUrl = getGmailAuthUrl(telegramId, binding.hash)
  if (!authUrl) {
    console.error('GMAIL_OAUTH_STATE_SECRET_MISSING')
    return NextResponse.json(
      { ok: false, error: 'Google connection is temporarily unavailable' },
      { status: 503 }
    )
  }

  const res = NextResponse.redirect(authUrl)
  setBindingCookie(res.cookies, binding.nonce)
  return res
}
