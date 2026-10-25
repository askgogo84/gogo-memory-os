// Duet parity step 2: "What you hear about" — check frequency, topics, quiet hours and the morning brief time.
// Owner-scoped (session), same-origin for browsers, bearer for the mobile apps.
import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { getAlertPreferences, parseAlertPreferencesBody, saveAlertPreferences } from '@/lib/agent/alert-preferences'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const BRIEF_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

async function readBrief(telegramId: string) {
  const { data, error } = await supabaseAdmin.from('users').select('briefing_enabled,briefing_time').eq('telegram_id', Number(telegramId)).maybeSingle()
  if (error) throw new Error(`brief_read_failed:${error.message}`)
  return { enabled: Boolean(data?.briefing_enabled), time: String(data?.briefing_time || '08:00').slice(0, 5) }
}

export async function GET(request: Request) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const [prefs, brief] = await Promise.all([getAlertPreferences(session.telegramId), readBrief(session.telegramId)])
    return NextResponse.json({ ...prefs, brief })
  } catch (err: any) {
    console.error('ALERT_PREFERENCES_GET_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const body: any = await request.json().catch(() => null)
  const prefs = parseAlertPreferencesBody(body)
  if (!prefs) return NextResponse.json({ error: 'invalid_preferences' }, { status: 400 })
  const brief = body?.brief
  if (brief !== undefined && (typeof brief?.enabled !== 'boolean' || !BRIEF_TIME.test(String(brief?.time || '')))) {
    return NextResponse.json({ error: 'invalid_brief' }, { status: 400 })
  }
  try {
    const saved = await saveAlertPreferences(session.telegramId, prefs)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 503 })
    if (brief) {
      const { error } = await supabaseAdmin.from('users').update({ briefing_enabled: brief.enabled, briefing_time: brief.time }).eq('telegram_id', Number(session.telegramId))
      if (error) throw new Error(`brief_write_failed:${error.message}`)
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('ALERT_PREFERENCES_PUT_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
