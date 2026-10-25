import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function resolveWhatsAppId(telegramId: string) {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return null
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('whatsapp_id')
    .eq('telegram_id', tgNum)
    .maybeSingle()
  if (error) throw error
  const value = String(data?.whatsapp_id || '').trim()
  return value || null
}

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const whatsappId = await resolveWhatsAppId(session.telegramId)
  if (!whatsappId) return NextResponse.json({ ok: false, error: 'whatsapp_not_linked' }, { status: 409 })

  const body = await request.json().catch(() => null) as any
  const text = String(body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!text) return NextResponse.json({ ok: false, error: 'task_required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('todos')
    .insert({ whatsapp_id: whatsappId, text, done: false, created_at: new Date().toISOString() })
    .select('id')
    .single()

  if (error) {
    console.error('DASHBOARD_TASK_CREATE_FAILED:', error.message)
    return NextResponse.json({ ok: false, error: 'task_create_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: String(data.id) })
}

export async function PATCH(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const whatsappId = await resolveWhatsAppId(session.telegramId)
  if (!whatsappId) return NextResponse.json({ ok: false, error: 'whatsapp_not_linked' }, { status: 409 })

  const body = await request.json().catch(() => null) as any
  const id = String(body?.id || '').trim()
  const done = body?.done
  if (!id || typeof done !== 'boolean') return NextResponse.json({ ok: false, error: 'malformed_request' }, { status: 400 })

  const patch = done
    ? { done: true, done_at: new Date().toISOString() }
    : { done: false, done_at: null }

  const { data, error } = await supabaseAdmin
    .from('todos')
    .update(patch)
    .eq('id', id)
    .eq('whatsapp_id', whatsappId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('DASHBOARD_TASK_UPDATE_FAILED:', error.message)
    return NextResponse.json({ ok: false, error: 'task_update_failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
