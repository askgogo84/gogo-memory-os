import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
) as any

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== process.env.ADMIN_DASHBOARD_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true })
    const { count: totalMessages } = await supabase.from('conversations').select('*', { count: 'exact', head: true })
    const { count: waUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).not('whatsapp_id', 'is', null)

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count: newUsers7d } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', since7d)

    return NextResponse.json({
      ok: true,
      totalUsers: totalUsers || 0,
      whatsappUsers: waUsers || 0,
      totalMessages: totalMessages || 0,
      newUsers7Days: newUsers7d || 0,
      timestamp: new Date().toISOString()
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
