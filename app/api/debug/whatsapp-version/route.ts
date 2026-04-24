import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: 'whatsapp-premium-v4',
    message: 'AskGogo WhatsApp premium UX is deployed',
    expected_replies: {
      hi: 'Premium AskGogo welcome message',
      help: 'Premium AskGogo menu',
      pricing: 'Starter ₹149, Pro ₹299, Family ₹399',
      notify_me: 'Founder list confirmation',
      invite_friends: 'Referral share message',
    },
    deployed_at: new Date().toISOString(),
  })
}
