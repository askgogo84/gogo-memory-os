import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const VALID_TIERS = ['free', 'starter', 'pro', 'founder_pro']

function normalizeWaId(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `whatsapp:+${digits}`
}

// GET /api/admin/users?q=phone_or_name
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  
  let query = supabaseAdmin
    .from('users')
    .select('telegram_id, name, whatsapp_id, tier, created_at, last_seen_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (q) {
    const digits = q.replace(/\D/g, '')
    if (digits.length > 5) {
      query = query.ilike('whatsapp_id', `%${digits}%`)
    } else {
      query = query.ilike('name', `%${q}%`)
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data })
}

// POST /api/admin/users — update tier or add user
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, phone, tier, name } = body

  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  // UPDATE TIER
  if (action === 'set_tier') {
    if (!phone || !tier) return NextResponse.json({ error: 'phone and tier required' }, { status: 400 })
    if (!VALID_TIERS.includes(tier)) return NextResponse.json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` }, { status: 400 })

    const digits = phone.replace(/\D/g, '')
    const waId = `whatsapp:+${digits}`

    // Find user by whatsapp_id
    const { data: user, error: findErr } = await supabaseAdmin
      .from('users')
      .select('telegram_id, name, whatsapp_id, tier')
      .ilike('whatsapp_id', `%${digits}%`)
      .single()

    if (findErr || !user) {
      // User not found — create them with the tier
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from('users')
        .insert({ whatsapp_id: waId, name: name || `User +${digits}`, tier })
        .select()
        .single()
      if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, action: 'created', user: newUser })
    }

    // Update existing user
    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ tier })
      .eq('telegram_id', user.telegram_id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'updated', user: { ...user, tier } })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
