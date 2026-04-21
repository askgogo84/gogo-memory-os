import { NextRequest, NextResponse } from 'next/server'
import { getGmailAuthUrl } from '@/lib/google-gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const telegramId = url.searchParams.get('telegramId')

  if (!telegramId) {
    return NextResponse.json(
      { ok: false, error: 'Missing telegramId' },
      { status: 400 }
    )
  }

  const authUrl = getGmailAuthUrl(Number(telegramId))
  return NextResponse.redirect(authUrl)
}
