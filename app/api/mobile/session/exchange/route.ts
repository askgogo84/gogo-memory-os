import { NextRequest, NextResponse } from 'next/server'
import { exchangeMobileLink } from '@/lib/mobile-auth/link'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any
  const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : null
  const pollToken = String(body?.pollToken || '').trim()
  if (!platform) return NextResponse.json({ error: 'invalid_platform' }, { status: 400 })
  if (pollToken.length < 32 || pollToken.length > 200) return NextResponse.json({ error: 'invalid_poll_token' }, { status: 400 })

  try {
    const session = await exchangeMobileLink({
      pollToken,
      platform,
      deviceId: String(body?.deviceId || '').slice(0, 160),
      deviceName: String(body?.deviceName || '').slice(0, 160),
    })
    if (!session) return NextResponse.json({ error: 'link_not_approved_or_expired' }, { status: 409 })
    return NextResponse.json(session)
  } catch (error: any) {
    console.error('MOBILE_LINK_EXCHANGE_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'link_exchange_failed' }, { status: 500 })
  }
}
