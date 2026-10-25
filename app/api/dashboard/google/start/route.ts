import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { buildGoogleDashboardAuthUrl, issueGoogleState, type GoogleMode } from '@/lib/dashboard/google-login'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const mode: GoogleMode = req.nextUrl.searchParams.get('mode') === 'link' ? 'link' : 'login'
  let telegramId: string | null = null

  if (mode === 'link') {
    const session = await getSession()
    if (!session) return NextResponse.redirect(new URL('/dashboard?google=login-required', req.url), 303)
    telegramId = session.telegramId
  }

  const state = await issueGoogleState(mode, telegramId)
  if (!state || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/dashboard?google=error', req.url), 303)
  }

  return NextResponse.redirect(buildGoogleDashboardAuthUrl(state), 302)
}
