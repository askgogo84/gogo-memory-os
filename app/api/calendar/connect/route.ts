import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl, verifyCalendarConnectToken } from '@/lib/google-calendar'
import { setOauthBindingCookie } from '@/lib/security/oauth-browser-binding'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const telegramId = verifyCalendarConnectToken(searchParams.get('token') || '')

  if (!telegramId) {
    return NextResponse.json({ ok:false, error:'Invalid or expired connection link' }, { status:401 })
  }

  try {
    // This is the page the WhatsApp / dashboard link opens, so the binding cookie lands in the browser that will
    // come back to /api/calendar/callback. No unbound Google URL is ever returned.
    const authUrl = getAuthUrl(telegramId)
    const res = NextResponse.redirect(authUrl)
    if (!setOauthBindingCookie(res, 'calendar', authUrl)) throw new Error('calendar_oauth_binding_unavailable')
    return res
  } catch (err) {
    console.error('CALENDAR_CONNECT_URL_FAILED:', err)
    return NextResponse.json({ ok:false, error:'Calendar connection is temporarily unavailable' }, { status:503 })
  }
}
