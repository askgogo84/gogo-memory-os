import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Never expose database records from a public production debug route.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { error } = await supabaseAdmin
      .from('users')
      .select('id', { head: true, count: 'exact' })
      .limit(1)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, connected: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
