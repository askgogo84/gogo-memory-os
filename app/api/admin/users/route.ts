import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '@/lib/admin/auth'
import { verifySameOrigin } from '@/lib/dashboard/guard'

export const dynamic = 'force-dynamic'

const VALID_TIERS = ['free', 'starter', 'pro', 'founder_pro']

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return createClient(url, key)
}

/**
 * Privileged mutations cannot infer a country code from a domestic number.
 * An explicit full E.164 phone is required, including + and country code.
 */
function canonicalTierTarget(phone: unknown): string | null {
  if (typeof phone !== 'string') return null
  const full = phone.trim().replace(/^whatsapp:/i, '').trim()
  return /^\+[1-9][0-9]{7,14}$/.test(full) ? full : null
}

function exactStoredPhoneForms(full: string): string[] {
  const digits = full.slice(1)
  return [full, `whatsapp:${full}`, digits, `whatsapp:${digits}`]
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession()
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status })

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
  const blocked = verifySameOrigin(req)
  if (blocked) return blocked
  const admin = await requireAdminSession()
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status })

  const body = await req.json()
  const { action, phone, tier, name } = body
  if (action === 'set_tier') {
    if (!phone || !tier) return NextResponse.json({ error: 'phone and tier required' }, { status: 400 })
    if (!VALID_TIERS.includes(tier)) return NextResponse.json({ error: `Invalid tier. Use: ${VALID_TIERS.join(', ')}` }, { status: 400 })

    const full = canonicalTierTarget(phone)
    if (!full) return NextResponse.json(
      { error: 'Full E.164 phone (+country code and number) required for a tier change' },
      { status: 400 },
    )

    const db = getClient()
    const digits = full.slice(1)
    const waId = `whatsapp:${full}`

    // This is an admin entitlement mutation, not a fuzzy account search.
    // Read at most two *exact* saved representations and reject ambiguity.
    // A failed lookup must never be treated as permission to create a user.
    const { data: matches, error: lookupError } = await db
      .from('users')
      .select('id, telegram_id, whatsapp_id, name, tier')
      .in('whatsapp_id', exactStoredPhoneForms(full))
      .limit(2)
    if (lookupError || !Array.isArray(matches)) {
      return NextResponse.json({ error: 'User lookup unavailable; no tier change made' }, { status: 503 })
    }
    if (matches.length > 1) {
      return NextResponse.json({ error: 'Multiple accounts match this complete phone; select an explicit account' }, { status: 409 })
    }

    const existing = matches[0]
    if (existing) {
      // IDs are stable row keys. A null/legacy telegram_id cannot target a
      // separate user's entitlement, and the matching phone is rechecked in
      // the UPDATE predicate to fail closed on an intervening identity change.
      if (typeof existing.id !== 'string' || !existing.id || typeof existing.whatsapp_id !== 'string') {
        return NextResponse.json({ error: 'Account identity is incomplete; no tier change made' }, { status: 409 })
      }
      const { data: updated, error: updateError } = await db
        .from('users')
        .update({ tier })
        .eq('id', existing.id)
        .eq('whatsapp_id', existing.whatsapp_id)
        .select('id, telegram_id, whatsapp_id, name, tier')
        .maybeSingle()
      if (updateError) return NextResponse.json({ error: 'Tier update failed' }, { status: 503 })
      if (!updated || updated.id !== existing.id || updated.whatsapp_id !== existing.whatsapp_id || updated.tier !== tier) {
        return NextResponse.json({ error: 'Account changed during update; verify and retry' }, { status: 409 })
      }
      return NextResponse.json({ ok: true, action: 'updated', user: updated })
    }

    // Pre-provisioning is allowed only after a successful exact zero-match
    // lookup for a complete international phone, never after a DB outage.
    const { data: newUser, error: createErr } = await db
      .from('users')
      .insert({ whatsapp_id: waId, name: name || `User +${digits}`, tier })
      .select()
      .single()
    if (createErr || !newUser) return NextResponse.json({ error: 'User provisioning failed' }, { status: 503 })
    return NextResponse.json({ ok: true, action: 'created', user: newUser })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
