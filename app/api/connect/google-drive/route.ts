// "Connect Google Drive" (stopgap via Composio while AskGogo's Google verification is pending): sends the
// signed-in person to Composio's Google consent screen for read access to their Drive.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { createDriveConnectLink, composioConfigured } from '@/lib/connectors/composio-gmail'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.redirect('https://app.askgogo.in/dashboard?next=' + encodeURIComponent('/dashboard/connections'))
  if (!composioConfigured()) return NextResponse.redirect('https://app.askgogo.in/dashboard/connections?error=drive_unavailable')
  try {
    return NextResponse.redirect(await createDriveConnectLink(session.telegramId))
  } catch (err: any) {
    console.error('COMPOSIO_DRIVE_CONNECT_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.redirect('https://app.askgogo.in/dashboard/connections?error=drive_unavailable')
  }
}
