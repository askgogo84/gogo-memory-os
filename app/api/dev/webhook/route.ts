// Legacy phone-number "admin" webhook is intentionally retired in every environment.
// It previously trusted an unverified caller-supplied phone in preview deployments,
// allowing privileged Vercel/GitHub/WhatsApp operations without caller authentication.
// A future development control plane needs separately reviewed authenticated authorization.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'not_found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}
