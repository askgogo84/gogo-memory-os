import { NextRequest, NextResponse } from 'next/server'
import { getMobileLinkStatus } from '@/lib/mobile-auth/link'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any
  const pollToken = String(body?.pollToken || '').trim()
  if (pollToken.length < 32 || pollToken.length > 200) {
    return NextResponse.json({ error: 'invalid_poll_token' }, { status: 400 })
  }

  try {
    const result = await getMobileLinkStatus(pollToken)
    if (result.status === 'not_found') return NextResponse.json({ error: 'link_not_found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('MOBILE_LINK_STATUS_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'link_status_failed' }, { status: 500 })
  }
}
