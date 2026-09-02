import { NextResponse } from 'next/server'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { hashIp } from '@/lib/dashboard/session'
import { issueDashboardOtp } from '@/lib/dashboard/whatsapp-otp'

export const dynamic = 'force-dynamic'

function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const xff = request.headers.get('x-forwarded-for')
  if (!xff) return ''
  const parts = xff.split(',')
  return parts[parts.length - 1].trim()
}

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  let phone = ''
  try {
    const body = await request.json()
    phone = typeof body?.phone === 'string' ? body.phone : ''
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const ipHash = hashIp(clientIp(request))
  if (!ipHash) return NextResponse.json({ ok: false }, { status: 503 })

  const result = await issueDashboardOtp(phone, ipHash)
  if (!result.ok) {
    if (result.reason === 'invalid') return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })
    if (result.reason === 'throttled') {
      return NextResponse.json(
        { ok: false, reason: 'throttled', retryAfterSeconds: result.retryAfterSeconds || 30 },
        { status: 429 },
      )
    }
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  // Same outward success whether the number belongs to an AskGogo user or not.
  return NextResponse.json({
    ok: true,
    challengeId: result.challengeId,
    retryAfterSeconds: result.retryAfterSeconds,
    message: 'If this WhatsApp number is linked to AskGogo, a login code is on its way.',
  })
}
