import { browserTargetUrl } from './sentinel'
import { isLoginFormPage } from './browser-evidence'

/**
 * Obscura is an optional, PUBLIC-READ-ONLY observer, never a browser-authority,
 * cookie/session store, approval source or booking executor.
 *
 * The pilot must be opt-in for both the environment and exact host. Unknown
 * site capabilities automatically fall back to the existing secure browser.
 */
export type ObscuraReadCandidate = {
  url: string
  title: string
  text: string
  observedAt: string
  runtime: 'obscura'
}
export type ObscuraRequest = {
  userId: string
  url: string
  objective: string
  mode: 'read' | 'draft' | 'execute'
  keepAlive?: boolean
  vaultCredentialId?: string | null
  accountCreation?: boolean
  providerBooking?: boolean
  resumePage?: boolean
  loginCode?: string | null
  bookingOtp?: string | null
  reserveHumanHandoff?: boolean
  reservePasswordHandoff?: boolean
  phoneLogin?: { number: string; telegramId: string } | null
  bookingPhone?: string | null
  slotCheck?: boolean
  rehearsal?: boolean
  recoverFlightSearch?: boolean
  keepAliveOwner?: string
  sessionTaskId?: string
}
export type ObscuraCommand = {
  url: string
  expression: string
  timeoutSeconds: number
}
export type ObscuraRunner = (command: ObscuraCommand, owner: string) => Promise<string>

// Query parsing must decode key names. A raw string regex misses
// access%5Ftoken and doubly encoded access%255Ftoken. Fragments are refused
// altogether, including SPA/#/token routes, because they can carry secrets.
const SECRET_PARAM_NAMES = new Set([
  'token','accesstoken','refreshtoken','idtoken','apikey','key','secret',
  'clientsecret','password','pass','passphrase','otp','code','session',
  'sessionid','auth','authorization','signature','state','nonce','jwt',
  'bearer','csrf','csrftoken','credential','credentials',
])
function containsCredentials(target:URL):boolean {
  if (target.hash) return true
  for (const [name] of target.searchParams) {
    let key=name
    // URLSearchParams decodes once, but a provider may interpret repeated
    // encoding after further parsing. Fail closed on up to three layers.
    for (let i=0;i<5;i++) {
      const normalized=key.toLowerCase().replace(/[^a-z0-9]/g,'')
      if (SECRET_PARAM_NAMES.has(normalized)
        || /token|apikey|secret|password|credential|session|signature|authorization|csrf|oauth/.test(normalized)
        || /^auth(?:entication)?/.test(normalized)) return true
      if (!key.includes('%')) break
      try {
        const decoded=decodeURIComponent(key)
        if (decoded===key) return true
        key=decoded
      } catch { return true }
    }
    if (key.includes('%')) return true // deeply encoded / still ambiguous key
  }
  return false
}
const BLOCK_TEXT = /^(?:access denied|forbidden|checking your browser|just a moment|enable javascript|sign in|log in|please wait|loading\.{0,3})\s*[.!…]*$/i

/**
 * The ordinary browser-command flow reserves password/Take Control by design.
 * Only a separate, explicit PUBLIC Flipkart product-search request can probe
 * Obscura before that path. Private account/order/cart/slot state is excluded.
 * No user data, credentials, cookies or handoff state are forwarded.
 */
export function explicitPublicRetailSearch(
  command: { url:string; objective:string; mode:'read'|'draft'|'execute'; risk?:string;
    approvalAction?:string; flow?:string; vaultCredentialId?:string },
  state: { handoff?:unknown; comparison_parent_id?:unknown; commerce_parent_id?:unknown;
    browser_safe_to_retry?:boolean } | null = null,
):boolean {
  if (command.mode!=='read' || command.risk!=='low' || command.approvalAction
    || command.flow || command.vaultCredentialId || state?.handoff
    || state?.comparison_parent_id || state?.commerce_parent_id
    || state?.browser_safe_to_retry===false) return false
  const instruction=command.objective.toLowerCase()
  if (!/\bread[ -]only\b/.test(instruction)
    || !/\b(?:price|prices|products?|compare|listed|offers?)\b/.test(instruction)
    || /\b(?:my|our|your)\s+(?:account|orders?|cart|basket|wishlist|address|profile|payments?|subscriptions?)\b/.test(instruction)
    || /\b(?:sign\s*in|log\s*in|login|password|otp|passkey|booking|reservation|checkout|payment)\b/.test(instruction)) return false
  try {
    const u=browserTargetUrl(command.url)
    return u.origin==='https://www.flipkart.com' && u.pathname==='/search'
      && !containsCredentials(u) && (u.searchParams.get('q')||'').trim().length>0
      && (u.searchParams.get('q')||'').length<=120
  } catch { return false }
}

export function obscuraPilotEligible(
  params: ObscuraRequest,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.GOGO_OBSCURA_PUBLIC_READ !== '1' || params.mode !== 'read'
    || params.keepAlive || params.vaultCredentialId || params.accountCreation
    || params.providerBooking || params.resumePage || params.loginCode
    || params.bookingOtp || params.reserveHumanHandoff
    || params.reservePasswordHandoff || params.phoneLogin || params.bookingPhone != null
    || params.slotCheck || params.rehearsal || params.recoverFlightSearch
    || params.keepAliveOwner) return false
  try {
    const target = browserTargetUrl(params.url)
    if (target.protocol !== 'https:' || target.username || target.password || target.port
      || containsCredentials(target)) return false
    // No implicit global allowlist, no wildcard, no top-level suffix match.
    const hosts = String(env.GOGO_OBSCURA_PILOT_HOSTS || '').split(',')
      .map(value => value.trim().toLowerCase()).filter(Boolean)
    return hosts.length > 0 && hosts.includes(target.hostname.toLowerCase())
  } catch {
    return false
  }
}

// The expression is a CONSTANT. No user objective, credentials or selectors
// enter the agent browser's JS execution context.
export const OBSCURA_READ_EXPRESSION =
  'JSON.stringify({url:location.href,title:document.title,text:document.body?document.body.innerText:""})'

export function parseObscuraObservation(
  originalUrl: string,
  raw: string,
  now: () => Date = () => new Date(),
): ObscuraReadCandidate | null {
  try {
    if (raw.length > 26000) return null
    let value: unknown = JSON.parse(raw.trim())
    if (typeof value === 'string') value = JSON.parse(value)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as { url?: unknown; title?: unknown; text?: unknown }
    if (typeof row.url !== 'string' || typeof row.title !== 'string'
      || typeof row.text !== 'string') return null
    const original = browserTargetUrl(originalUrl)
    const final = browserTargetUrl(row.url)
    if (final.origin !== original.origin || final.protocol !== 'https:'
      || final.username || final.password || final.port
      || containsCredentials(final)) return null
    const title = row.title.replace(/\s+/g, ' ').trim().slice(0, 300)
    const text = row.text.replace(/\s+/g, ' ').trim().slice(0, 12000)
    if ((!title && !text) || BLOCK_TEXT.test(text) || BLOCK_TEXT.test(title)
      || isLoginFormPage({ url: final.href, title, text })) return null
    return { url: final.href, title, text, observedAt: now().toISOString(), runtime: 'obscura' }
  } catch {
    return null
  }
}

export async function readWithObscura(
  params: ObscuraRequest,
  runner: ObscuraRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<ObscuraReadCandidate | null> {
  if (!obscuraPilotEligible(params, env)) return null
  try {
    const raw = await runner({
      url: browserTargetUrl(params.url).href,
      expression: OBSCURA_READ_EXPRESSION,
      timeoutSeconds: 15,
    }, params.userId)
    return parseObscuraObservation(params.url, raw)
  } catch {
    // Only a READ was attempted; let the already-reviewed browser own recovery.
    return null
  }
}
