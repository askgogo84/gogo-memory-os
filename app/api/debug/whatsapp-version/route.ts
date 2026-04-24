import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: 'whatsapp-premium-v3',
    expected_hi_reply: 'Hey there, I’m AskGogo 👋',
    expected_pricing: {
      starter: '₹149/month',
      pro: '₹299/month',
      family: '₹399/month',
    },
    deployed_at: new Date().toISOString(),
  })
}
