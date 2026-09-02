import { NextResponse } from 'next/server'
import { LIFECYCLE_EMAILS, renderLifecycleEmail } from '@/lib/email/lifecycle'
import { sendAskGogoEmail } from '@/lib/email/resend'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Preview-only smoke test. Never available on production.
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ ok: false, error: 'Not available outside preview' }, { status: 404 })
  }

  const first = LIFECYCLE_EMAILS[0]
  if (!first) return NextResponse.json({ ok: false, error: 'No lifecycle email configured' }, { status: 500 })

  const recipient = 'gogo@askgogo.in'
  const rendered = renderLifecycleEmail({
    email: first,
    firstName: 'Gogo',
    unsubscribeUrl: 'https://app.askgogo.in/dashboard/you',
  })

  const result = await sendAskGogoEmail({
    to: recipient,
    subject: `[TEST] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: 'preview/lifecycle/day-0/gogo-at-askgogo',
  })

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
  return NextResponse.json({ ok: true, to: recipient, subject: `[TEST] ${rendered.subject}`, providerId: result.id })
}
