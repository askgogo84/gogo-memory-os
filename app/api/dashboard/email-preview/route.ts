import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LIFECYCLE_EMAILS, renderLifecycleEmail } from '@/lib/email/lifecycle'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return new NextResponse('Sign in to preview Gogo Tips.', { status: 401 })

  const indexRaw = Number(new URL(req.url).searchParams.get('day') || '0')
  const index = Number.isFinite(indexRaw) ? Math.max(0, Math.min(LIFECYCLE_EMAILS.length - 1, Math.floor(indexRaw))) : 0
  const entry = LIFECYCLE_EMAILS[index]

  const tg = Number(session.telegramId)
  const { data: user } = Number.isFinite(tg)
    ? await supabaseAdmin.from('users').select('name').eq('telegram_id', tg).maybeSingle()
    : { data: null as any }
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0] || 'there'

  const rendered = renderLifecycleEmail({
    email: entry,
    firstName,
    unsubscribeUrl: 'https://app.askgogo.in/dashboard/you',
  })

  return new NextResponse(rendered.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
