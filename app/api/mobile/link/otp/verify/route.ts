import { NextRequest, NextResponse } from 'next/server'
import { verifyWhatsappOtpLink } from '@/lib/mobile-auth/otp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any
  const pollToken = String(body?.pollToken || '').trim()
  const code = String(body?.code || '').trim()
  if (pollToken.length < 32 || pollToken.length > 200) return NextResponse.json({ error: 'invalid_poll_token' }, { status: 400 })
  if (!/^\d{6}$/.test(code.replace(/\D/g, ''))) return NextResponse.json({ error: 'invalid_code' }, { status: 400 })

  try {
    const approved = await verifyWhatsappOtpLink({ pollToken, code })
    if (!approved) return NextResponse.json({ error: 'invalid_or_expired_code' }, { status: 409 })
    return NextResponse.json({ approved: true })
  } catch (error: any) {
    console.error('MOBILE_OTP_VERIFY_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'verification_failed' }, { status: 500 })
  }
}
