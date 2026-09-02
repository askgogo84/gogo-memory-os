import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id') || ''

  if (!/^-?\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid calendar link' }, { status: 400 })
  }

  const telegramId = Number(id)
  if (!Number.isSafeInteger(telegramId)) {
    return NextResponse.json({ ok: false, error: 'Invalid calendar link' }, { status: 400 })
  }

  return NextResponse.redirect(getAuthUrl(telegramId), 302)
}
