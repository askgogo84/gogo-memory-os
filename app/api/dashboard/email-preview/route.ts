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

  // A signed-in session's legacy owner can be a lossless BIGINT decimal string.
  // Never coerce an imprecise or partial identity before a service-role read.
  const owner = typeof session.telegramId === 'string' || typeof session.telegramId === 'number'
    ? String(session.telegramId) : ''
  if (!/^-?[1-9]\d*$/.test(owner) || !Number.isSafeInteger(Number(owner)) || String(Number(owner)) !== owner) {
    return new NextResponse('Invalid session owner.', { status: 403 })
  }

  const { data: user, error } = await supabaseAdmin.from('users')
    .select('telegram_id,name').eq('telegram_id', owner).maybeSingle()
  if (error) return new NextResponse('Email preview temporarily unavailable.', { status: 503 })
  if (!user || String(user.telegram_id) !== owner) {
    return new NextResponse('Email preview account not found.', { status: 404 })
  }
  const firstName = String(user.name || 'there').trim().split(/\s+/)[0] || 'there'

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
