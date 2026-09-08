import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    version: 'whatsapp-premium-v5-free-lite-pro-power',
    message: 'AskGogo WhatsApp premium UX is deployed',
    expected_replies: {
      hi: 'AskGogo welcome message',
      help: 'AskGogo menu',
      pricing: 'Free ₹0, Lite ₹99, Pro ₹299, Power ₹499',
      invite_friends: 'Referral share message',
    },
    checked_at: new Date().toISOString(),
  })
}
