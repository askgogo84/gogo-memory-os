import { NextResponse } from 'next/server'

// ── Same-origin guard for dashboard mutations ─────────────────────────────────
// WHY THIS EXISTS — do not "simplify" it away:
//
// The dashboard session cookie is sameSite=lax. SameSite keys on the registrable
// SITE (eTLD+1), NOT on the origin. askgogo.in and app.askgogo.in share the same
// registrable domain, so the marketing site is *same-site* with the app and the
// browser WILL attach the session cookie to a request the marketing site makes to
// the app. That marketing site is a separately-deployed static export with weaker
// provenance than the app — if it (or anything injected into it) is ever coaxed
// into POSTing to the app, Lax alone would let the cookie ride along.
//
// This check removes the browser from the trust chain: instead of trusting the
// browser's SameSite enforcement, the SERVER asserts that a state-changing request
// actually originated from its own origin. Lax remains the outer layer (it blocks
// cross-site cookies on non-GET at all); this is the inner layer that also fences
// out the same-SITE-but-different-ORIGIN marketing deployment.
//
// The companion invariant lives in the routes: NO mutation is ever reachable by
// GET. Lax attaches the cookie on top-level GET navigation, so a GET mutation is
// CSRF-able no matter what this guard does. Keep every write on POST/PATCH/DELETE.

// Reject a cross-origin (or unattributable) mutation. Generic 403, no detail to
// the client — the mismatch is logged server-side for debugging preview deploys.
function reject(reason: string, detail?: string): NextResponse {
  console.warn('DASHBOARD_ORIGIN_REJECTED:', reason, detail ?? '')
  return NextResponse.json({ ok: false }, { status: 403 })
}

function nonEmpty(value: string | null): string | null {
  const v = value?.trim()
  return v ? v : null
}

// The host portion (incl. port) of a full URL, lowercased — or null if the value
// isn't a parseable absolute URL. `Origin: null` (sandboxed iframes, some
// redirects) fails to parse here and so is correctly treated as non-matching.
function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Assert that a state-changing request came from this deployment's own origin.
 * Returns a 403 NextResponse to return from the handler, or null when the request
 * is allowed. Call at the very top of every dashboard mutation:
 *
 *   export async function POST(request: Request) {
 *     const blocked = verifySameOrigin(request)
 *     if (blocked) return blocked
 *     const session = await getSession()
 *     ...
 *   }
 *
 * The expected origin is DERIVED FROM THE REQUEST HOST (x-forwarded-host on
 * Vercel, else Host), never hardcoded — so production, every preview deployment,
 * and localhost each validate against their own host with no config.
 */
export function verifySameOrigin(request: Request): NextResponse | null {
  // Our own host, as the client actually addressed it. On Vercel x-forwarded-host
  // is the client-facing host; Host may be the internal one. Prefer the former.
  const expectedHost = nonEmpty(request.headers.get('x-forwarded-host'))
    ?? nonEmpty(request.headers.get('host'))
  // Can't determine our own host → cannot verify → fail closed.
  if (!expectedHost) return reject('no_host')
  const expected = expectedHost.toLowerCase()

  // Origin is the primary signal. When absent, fall back to Referer with the same
  // rule. A same-origin fetch from our app always sends one of these; if BOTH are
  // absent on a mutation we refuse rather than assume good faith.
  const origin = nonEmpty(request.headers.get('origin'))
  const referer = nonEmpty(request.headers.get('referer'))
  const candidate = origin ?? referer
  if (!candidate) return reject('no_origin_or_referer')

  const host = hostOf(candidate)
  if (!host) return reject('unparseable', candidate)
  if (host !== expected) return reject('mismatch', `${host} != ${expected}`)

  return null
}
