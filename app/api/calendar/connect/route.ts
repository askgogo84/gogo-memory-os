import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl, verifyCalendarConnectToken } from '@/lib/google-calendar'
import { newOauthBinding, setBindingCookie } from '@/lib/security/oauth-browser-binding'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const telegramId = verifyCalendarConnectToken(searchParams.get('token') || '')

  if (!telegramId) {
    return NextResponse.json({ ok:false, error:'Invalid or expired connection link' }, { status:401 })
  }

  try {
    // Bind the OAuth state to this browser so a copied Google URL cannot be finished by someone else.
    const binding=newOauthBinding()
    const res=NextResponse.redirect(getAuthUrl(telegramId,binding.hash))
    setBindingCookie(res.cookies,binding.nonce)
    return res
  } catch (err) {
    console.error('CALENDAR_CONNECT_URL_FAILED:', err)
    return NextResponse.json({ ok:false, error:'Calendar connection is temporarily unavailable' }, { status:503 })
  }
}
