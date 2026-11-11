import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactDashboardOwnerId } from '@/lib/dashboard/exact-owner-id'

export const dynamic = 'force-dynamic'

const PERSONALITIES = new Set(['calm_companion', 'sharp_professional', 'straight_talking_coach', 'quiet_minimalist'])
const DRINKS = new Set(['coffee', 'tea', 'matcha', 'water', 'hot_chocolate', 'coconut_water'])

// Preserve legacy numeric predicates for safely representable owners; all other
// signed BIGINT session identities remain exact decimal strings in PostgREST.
// Invalid/truncated owner IDs must not cause any service-role query or write.
function experienceOwnerId(raw: unknown): number | string | null {
  const owner = exactDashboardOwnerId(raw)
  if (!owner) return null
  const n = Number(owner)
  return Number.isSafeInteger(n) && String(n) === owner ? n : owner
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const tg = experienceOwnerId(session.telegramId)
  if (tg === null) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('user_experience_preferences')
    .select('personality, comfort_drink')
    .eq('telegram_id', tg)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  return NextResponse.json({
    personality: data?.personality || 'calm_companion',
    comfortDrink: data?.comfort_drink || 'coffee',
  })
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const tg = experienceOwnerId(session.telegramId)
  if (tg === null) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })

  const body = await req.json().catch(() => null) as any
  // 12 Nov: choosing a companion character is saved on its own (no personality or drink needed).
  if (body && typeof body === 'object' && 'companion' in body && !('personality' in body)) {
    const { isCrewId } = await import('@/lib/gogo/crew')
    if (!isCrewId(body.companion)) return NextResponse.json({ error: 'invalid_preference' }, { status: 400 })
    const { saveCompanionChoice } = await import('@/lib/dashboard/companion-choice')
    const ok = await saveCompanionChoice(session.telegramId, body.companion)
    return ok ? NextResponse.json({ ok: true, companion: body.companion }) : NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  const personality = String(body?.personality || '')
  const comfortDrink = String(body?.comfortDrink || '')
  if (!PERSONALITIES.has(personality) || !DRINKS.has(comfortDrink)) {
    return NextResponse.json({ error: 'invalid_preference' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('user_experience_preferences')
    .upsert({
      telegram_id: tg,
      personality,
      comfort_drink: comfortDrink,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'telegram_id' })

  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, personality, comfortDrink })
}
