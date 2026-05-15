import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VALID_TIERS = ['free', 'starter', 'pro', 'founder_pro']

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return createClient(url, key)
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const db = getClient()

  let query = db
    .from('users')
    .select('telegram_id, name, whatsapp_id, tier, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (q.trim()) {
    const digits = q.replace(/\D/g, '')
    if (digits.length > 4) {
      query = (query as any).ilike('whatsapp_id', `%${digits}%`)
    } else {
      query = (query as any).ilike('name', `%${q}%`)
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data || [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, phone, tier, name } = body
  const db = getClient()

  if (action === 'set_tier') {
    if (!phone || !tier) return NextResponse.json({ error: 'phone and tier required' }, { status: 400 })
    if (!VALID_TIERS.includes(tier)) return NextResponse.json({ error: `Invalid tier. Use: ${VALID_TIERS.join(', ')}` }, { status: 400 })

    const digits = phone.replace(/\D/g, '')
    const waId = `whatsapp:+${digits}`

    // Check if user exists
    const { data: existing } = await db
      .from('users')
      .select('telegram_id, whatsapp_id, name, tier')
      .ilike('whatsapp_id', `%${digits}%`)
      .limit(1)
      .single()

    if (existing) {
      // Update existing
      await db.from('users').update({ tier }).eq('telegram_id', existing.telegram_id)
      return NextResponse.json({ ok: true, action: 'updated', user: { ...existing, tier } })
    }

    // Create new pre-provisioned user
    const { data: newUser, error: createErr } = await db
      .from('users')
      .insert({ whatsapp_id: waId, name: name || `User +${digits}`, tier })
      .select()
      .single()

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'created', user: newUser })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
