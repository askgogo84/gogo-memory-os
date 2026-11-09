import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Retired in every environment: the legacy handler accepted arbitrary caller-supplied
// account IDs and could grant Pro access using the service-role database client.
// A preview or development deployment may point at shared user data; environment
// name is not an authorization boundary. New subscriptions use the separately
// authorized Razorpay flow, never this endpoint.
export async function POST() {
  return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
}
