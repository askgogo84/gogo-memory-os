// "Continue with Google" on Settings › Email: sends the signed-in person to Composio's Google consent screen.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { createGmailConnectLink, composioConfigured } from '@/lib/connectors/composio-gmail'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.redirect('https://app.askgogo.in/dashboard')
  if (!composioConfigured()) return NextResponse.redirect('https://app.askgogo.in/dashboard/settings/email?error=google_unavailable')
  try {
    return NextResponse.redirect(await createGmailConnectLink(Number(session.telegramId)))
  } catch (err: any) {
    console.error('COMPOSIO_CONNECT_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.redirect('https://app.askgogo.in/dashboard/settings/email?error=google_unavailable')
  }
}
