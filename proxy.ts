import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

// Background-job heartbeats for the admin console's System health tab. Only observes: the request always
// continues to the route unchanged, and only genuine cron calls (with the cron secret) are recorded.
export function proxy(request: NextRequest, event: NextFetchEvent) {
  const secret = process.env.CRON_SECRET
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (secret && url && key && request.headers.get('authorization') === `Bearer ${secret}`) {
    const job = request.nextUrl.pathname.split('/').pop() || 'unknown'
    event.waitUntil(
      fetch(`${url}/rest/v1/rpc/admin_cron_heartbeat`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_job: job }),
      }).then(() => undefined, () => undefined),
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/cron/:path*', '/api/followups'],
}
