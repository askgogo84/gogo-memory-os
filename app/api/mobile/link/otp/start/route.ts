import { NextRequest, NextResponse } from 'next/server'
import { startWhatsappOtpLink } from '@/lib/mobile-auth/otp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any
  const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : null
  const whatsappNumber = String(body?.whatsappNumber || '').trim()
  if (!platform) return NextResponse.json({ error: 'invalid_platform' }, { status: 400 })
  if (!whatsappNumber || whatsappNumber.length > 30) return NextResponse.json({ error: 'invalid_whatsapp_number' }, { status: 400 })

  try {
    const result = await startWhatsappOtpLink({
      whatsappNumber,
      platform,
      deviceId: String(body?.deviceId || '').slice(0, 160),
      deviceName: String(body?.deviceName || '').slice(0, 160),
    })
    return NextResponse.json(result, { status: 202 })
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message === 'invalid_whatsapp_number') return NextResponse.json({ error: message }, { status: 400 })
    if (message === 'too_many_codes') return NextResponse.json({ error: message }, { status: 429 })
    console.error('MOBILE_OTP_START_FAILED:', message || error)
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 })
  }
}
