import { NextRequest, NextResponse } from 'next/server'
import { createMobileLinkRequest } from '@/lib/mobile-auth/link'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any
  const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : null
  if (!platform) return NextResponse.json({ error: 'invalid_platform' }, { status: 400 })

  const deviceId = String(body?.deviceId || '').trim().slice(0, 160)
  const deviceName = String(body?.deviceName || '').trim().slice(0, 160)

  // Basic abuse guard. The pairing code can only be approved from a real
  // AskGogo WhatsApp identity, but avoid unlimited request creation per device.
  if (deviceId) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error } = await supabaseAdmin
      .from('mobile_link_requests')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .gte('created_at', since)
    if (error) return NextResponse.json({ error: 'link_service_unavailable' }, { status: 503 })
    if ((count || 0) >= 8) return NextResponse.json({ error: 'too_many_link_requests' }, { status: 429 })
  }

  try {
    const result = await createMobileLinkRequest({ platform, deviceId, deviceName })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('MOBILE_LINK_START_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'link_start_failed' }, { status: 500 })
  }
}
