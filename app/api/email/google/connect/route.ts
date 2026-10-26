// "Continue with Google" on Settings › Email: sends the signed-in person to Composio's Google consent screen.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { createGmailConnectLink, composioConfigured } from '@/lib/connectors/composio-gmail'

/** The Composio Gmail API here still accepts number owners. Reject rounded persisted
 * session identities before any OAuth link can be created for a different account.
 * A future reviewed connector-wide string-owner migration can lift this guard.
 */
function exactLegacyGmailOwner(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?[1-9][0-9]*$/.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && String(numeric) === value ? numeric : null
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.redirect('https://app.askgogo.in/dashboard')
  if (!composioConfigured()) return NextResponse.redirect('https://app.askgogo.in/dashboard/settings/email?error=google_unavailable')
  // Fail closed for imprecise/invalid owners. Never bind Composio to a rounded id.
  const owner = exactLegacyGmailOwner(session.telegramId)
  if (owner === null) return NextResponse.redirect('https://app.askgogo.in/dashboard/settings/email?error=google_unavailable')
  try {
    return NextResponse.redirect(await createGmailConnectLink(owner))
  } catch (err: any) {
    console.error('COMPOSIO_CONNECT_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.redirect('https://app.askgogo.in/dashboard/settings/email?error=google_unavailable')
  }
}
