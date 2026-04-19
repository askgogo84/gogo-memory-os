import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const telegramId = searchParams.get('id')

  if (!telegramId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const authUrl = getAuthUrl(parseInt(telegramId))
  return NextResponse.redirect(authUrl)
}