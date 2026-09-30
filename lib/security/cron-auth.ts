import { timingSafeEqual } from 'crypto'

function safeEqual(a:string,b:string){
  const left=Buffer.from(a)
  const right=Buffer.from(b)
  return left.length===right.length&&timingSafeEqual(left,right)
}

export function isCronAuthorized(request:Request, env:Record<string,string|undefined>=process.env){
  const expected=String(env.CRON_SECRET||'').trim()
  if(!expected){
    console.error('CRON_SECRET_MISSING')
    return false
  }
  const auth=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  let query=''
  try{query=new URL(request.url).searchParams.get('secret')||''}catch{}
  return safeEqual(auth,expected)||safeEqual(query,expected)
}

// ── Internal service-to-service auth ──────────────────────────────────────────
// A few legacy HTTP routes (todos, contacts, expenses, news, skin-reminder,
// briefing, reminders/create, referral) are called SERVER-TO-SERVER by our own
// bot pipeline (the signed WhatsApp/Telegram webhook handlers, via
// lib/feature-intents-legacy.ts). Each acts on behalf of an arbitrary user — the
// `phone` the trusted pipeline already resolved from the verified webhook — so it
// cannot use a per-user dashboard session. Instead it authenticates the CALLER as
// our own backend, using the same platform CRON_SECRET already provisioned for
// cron, with the same timing-safe shared-secret check. A caller-supplied phone is
// therefore NEVER authorization; the Bearer secret is. Fails closed when the
// secret is unset (isCronAuthorized returns false), never a permissive fallback.
export function isInternalServiceAuthorized(request:Request, env:Record<string,string|undefined>=process.env){
  return isCronAuthorized(request, env)
}

// Header a trusted internal caller attaches so isInternalServiceAuthorized accepts
// it. Emits an empty Bearer when the secret is unset so the downstream call fails
// closed (401) rather than silently proceeding unauthenticated.
export function internalServiceAuthHeaders(env:Record<string,string|undefined>=process.env):Record<string,string>{
  return { Authorization:`Bearer ${String(env.CRON_SECRET||'').trim()}` }
}
