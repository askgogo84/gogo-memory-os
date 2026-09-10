import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl, verifyCalendarConnectToken } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const telegramId = verifyCalendarConnectToken(searchParams.get('token') || '')

  if (!telegramId) {
    return NextResponse.json({ ok:false, error:'Invalid or expired connection link' }, { status:401 })
  }

  try {
    return NextResponse.redirect(getAuthUrl(telegramId))
  } catch (err) {
    console.error('CALENDAR_CONNECT_URL_FAILED:', err)
    return NextResponse.json({ ok:false, error:'Calendar connection is temporarily unavailable' }, { status:503 })
  }
}
