import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent } from '@/lib/feature-intents'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

function cleanHistory(role: string, raw: string): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  if (/^\[(?:image_media|pending_skin_check|completed_skin_check|button:|dashboard link sent)/i.test(text)) return null
  if (role === 'user' && /^\[(?:asset|asset pdf|image|image note|food photo|image ticket|pdf|pdf document|meeting audio|typed meeting notes)\]/i.test(text)) {
    const trailing = text.replace(/^\[[^\]]+\]\s*/i, '').trim()
    return trailing || 'Shared something with Gogo'
  }
  return redactSecretShapedText(text)
}

async function resolveDashboardUser(telegramId: string) {
  const tg = parseInt(telegramId, 10)
  if (!Number.isFinite(tg)) return null
  const { data } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id, name')
    .eq('telegram_id', tg)
    .maybeSingle()
  return data || null
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await resolveDashboardUser(session.telegramId)
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('role, content, created_at')
    .eq('telegram_id', user.telegram_id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: 'history_failed' }, { status: 500 })
  const messages = (data || [])
    .reverse()
    .map((row: any) => ({
      role: row.role,
      content: cleanHistory(row.role, row.content),
      createdAt: row.created_at,
    }))
    .filter((row: any) => row.content)

  return NextResponse.json({ messages, name: user.name || 'Gogo' })
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await resolveDashboardUser(session.telegramId)
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  if (!user.whatsapp_id) return NextResponse.json({ error: 'whatsapp_not_linked' }, { status: 409 })

  const body = await req.json().catch(() => null) as any
  const text = String(body?.text || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'empty_message' }, { status: 400 })

  try {
    // Match WhatsApp's feature layer first so web chat operates the same reminders,
    // lists, expenses, nutrition and Asset Memory instead of creating a second brain.
    const featureReply = await routeFeatureIntent(String(user.whatsapp_id), text, {
      telegramId: Number(user.telegram_id),
      caption: text,
    })

    if (featureReply) {
      await supabaseAdmin.from('conversations').insert([
        { telegram_id: user.telegram_id, role: 'user', content: text },
        { telegram_id: user.telegram_id, role: 'assistant', content: featureReply },
      ])
      return NextResponse.json({ text: redactSecretShapedText(featureReply) })
    }

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: String(user.whatsapp_id),
      text,
      userName: user.name || 'Gogo',
      messageType: 'text',
      messageId: `web-${randomUUID()}`,
    })

    return NextResponse.json({
      text: redactSecretShapedText(result.text),
      mediaUrl: result.mediaUrl || null,
      mediaType: result.mediaType || null,
    })
  } catch (error: any) {
    console.error('DASHBOARD_CHAT_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'chat_failed', message: 'Gogo had trouble with that. Try once more.' }, { status: 500 })
  }
}
