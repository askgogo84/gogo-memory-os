import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-calendar'
import { calendarOwnerForLegacyEntry } from '@/lib/services/calendar-legacy-entry'
import { newOauthBinding, setBindingCookie } from '@/lib/security/oauth-browser-binding'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Never mint a valid Google OAuth state for a caller-selected ?id=<telegram_id>.
  // The canonical /api/calendar/connect entry already requires a signed bearer link.
  const telegramId = calendarOwnerForLegacyEntry(new URL(req.url).searchParams)
  if (telegramId === null) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired Calendar link. Request a fresh connection link in AskGogo.' },
      { status: 401 },
    )
  }

  try {
    const binding = newOauthBinding()
    const res = NextResponse.redirect(getAuthUrl(telegramId, binding.hash), 302)
    setBindingCookie(res.cookies, binding.nonce)
    return res
  } catch (error) {
    console.error('CALENDAR_LEGACY_CONNECT_FAILED:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ ok: false, error: 'Calendar connection is temporarily unavailable' }, { status: 503 })
  }
}
