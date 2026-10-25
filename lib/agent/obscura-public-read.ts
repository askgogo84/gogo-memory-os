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
  sessionTaskId?: string
}
export type ObscuraCommand = {
  url: string
  expression: string
  timeoutSeconds: number
}
export type ObscuraRunner = (command: ObscuraCommand, owner: string) => Promise<string>

const PRIVATE_QUERY_KEY = /(?:^|&)(?:token|access_token|refresh_token|api_key|key|secret|password|otp|code|session|auth|signature|state)=/i
const BLOCK_TEXT = /^(?:access denied|forbidden|checking your browser|just a moment|enable javascript|sign in|log in|please wait|loading\.{0,3})\s*[.!…]*$/i

export function obscuraPilotEligible(
  params: ObscuraRequest,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.GOGO_OBSCURA_PUBLIC_READ !== '1' || params.mode !== 'read'
    || params.keepAlive || params.vaultCredentialId || params.accountCreation
    || params.providerBooking || params.resumePage || params.loginCode
    || params.bookingOtp || params.reserveHumanHandoff) return false
  try {
    const target = browserTargetUrl(params.url)
    if (target.protocol !== 'https:' || target.username || target.password || target.port
      || PRIVATE_QUERY_KEY.test(target.search.slice(1))) return false
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
      || PRIVATE_QUERY_KEY.test(final.search.slice(1))) return null
    const title = row.title.replace(/\s+/g, ' ').trim().slice(0, 300)
    const text = row.text.replace(/\s+/g, ' ').trim().slice(0, 12000)
    if ((!title && !text) || BLOCK_TEXT.test(text) || BLOCK_TEXT.test(title)
      || isLoginFormPage({ url: final.href, title, text })) return null
    // URL fragments may leak page navigation state; never retain them.
    final.hash = ''
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
