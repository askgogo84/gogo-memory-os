import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Retired (red #1171). The "LINK ABCD-1234" WhatsApp device-code pairing never had a WhatsApp handler, and its
// parser read ordinary text such as "connect calendar" as a device code. Mobile sign-in is the WhatsApp OTP flow
// (/api/mobile/link/otp/start + /verify, then /api/mobile/link/status and /api/mobile/session/exchange).
// This route does no database work and creates no pairing request.
export function POST() {
  return NextResponse.json(
    { error: 'mobile_link_retired', message: 'Device-code linking is no longer available. Sign in with the WhatsApp verification code.' },
    { status: 410 },
  )
}
