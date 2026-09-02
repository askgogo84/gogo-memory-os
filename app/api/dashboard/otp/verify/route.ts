import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/dashboard/session'
import { verifyDashboardOtp } from '@/lib/dashboard/whatsapp-otp'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  let challengeId = ''
  let otp = ''
  try {
    const body = await request.json()
    challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
    otp = typeof body?.otp === 'string' ? body.otp : ''
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const verified = await verifyDashboardOtp(challengeId, otp)
  if (!verified.ok) {
    const status = verified.reason === 'error' || verified.reason === 'misconfigured' ? 503 : 401
    return NextResponse.json({ ok: false }, { status })
  }

  const sessionId = await createSession(verified.telegramId)
  if (!sessionId) return NextResponse.json({ ok: false }, { status: 500 })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ ok: true })
}
