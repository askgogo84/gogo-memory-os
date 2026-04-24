import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function mask(value?: string) {
  if (!value) return null
  return {
    exists: true,
    length: value.length,
    startsWithHttps: value.startsWith('https://'),
    value,
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    media_env: {
      ASKGOGO_WELCOME_GIF_URL: mask(process.env.ASKGOGO_WELCOME_GIF_URL),
      ASKGOGO_PRICING_IMAGE_URL: mask(process.env.ASKGOGO_PRICING_IMAGE_URL),
      ASKGOGO_SUCCESS_GIF_URL: mask(process.env.ASKGOGO_SUCCESS_GIF_URL),
      ASKGOGO_REFERRAL_GIF_URL: mask(process.env.ASKGOGO_REFERRAL_GIF_URL),
      ASKGOGO_THINKING_GIF_URL: mask(process.env.ASKGOGO_THINKING_GIF_URL),
    },
    checked_at: new Date().toISOString(),
  })
}
