import {createHash, randomBytes, timingSafeEqual} from 'node:crypto'
import {COMMERCE_PROVIDERS, commerceCallback, type CommerceProvider} from './providers'

export type CommerceAuthFlow = {
  provider: CommerceProvider; owner: string; state: string; verifier: string;
  clientId: string; redirectUri: string; createdAt: number; runId?: string;
}
export type CommerceToken = {accessToken: string; expiresAt: number; scope: string}

export function newCommerceFlow(provider: CommerceProvider, owner: string, clientId: string, now = Date.now()): CommerceAuthFlow {
  if (!owner || !clientId) throw new Error('commerce_auth_identity_missing')
  return {provider, owner, clientId, state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), redirectUri: commerceCallback(provider), createdAt: now}
}

export function commerceAuthorizeUrl(flow: CommerceAuthFlow) {
  const config = COMMERCE_PROVIDERS[flow.provider]
  const url = new URL(config.authorize)
  url.search = new URLSearchParams({response_type: 'code', client_id: flow.clientId, redirect_uri: flow.redirectUri,
    state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: config.scope, resource: config.resource}).toString()
  return url.href
}

export function validateCommerceCallback(flow: CommerceAuthFlow, provider: CommerceProvider, owner: string, state: string, issuer: string | null, now = Date.now()) {
  const age = now - flow.createdAt
  if (flow.provider !== provider || flow.owner !== owner || !Number.isFinite(age) || age < 0 || age > 10 * 60_000
      || flow.redirectUri !== commerceCallback(provider) || !flow.clientId || !flow.verifier) throw new Error('commerce_auth_binding_invalid')
  const a = Buffer.from(flow.state || ''), b = Buffer.from(state || '')
  if (a.length !== 43 || a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('commerce_auth_state_invalid')
  if (issuer && issuer !== COMMERCE_PROVIDERS[provider].issuer) throw new Error('commerce_auth_issuer_invalid')
}

export async function registerCommerceClient(provider: CommerceProvider, request: typeof fetch = fetch) {
  const configured = process.env[`COMMERCE_${provider.toUpperCase()}_CLIENT_ID`]
  if (configured) return configured
  const response = await request(COMMERCE_PROVIDERS[provider].register, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_name: 'AskGogo', redirect_uris: [commerceCallback(provider)],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none'}),
  })
  if (!response.ok) throw new Error('commerce_client_registration_failed')
  const data = await response.json()
  if (typeof data.client_id !== 'string' || !data.client_id || (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== 'none')) throw new Error('commerce_client_registration_invalid')
  return data.client_id
}

export async function exchangeCommerceCode(flow: CommerceAuthFlow, code: string, request: typeof fetch = fetch): Promise<CommerceToken> {
  if (!code || code.length > 4096) throw new Error('commerce_auth_code_invalid')
  const config = COMMERCE_PROVIDERS[flow.provider]
  const fields = {grant_type: 'authorization_code', client_id: flow.clientId, code, code_verifier: flow.verifier,
    redirect_uri: flow.redirectUri, resource: config.resource}
  const response = await request(config.token, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: {'Content-Type': config.tokenFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded'},
    body: config.tokenFormat === 'json' ? JSON.stringify(fields) : new URLSearchParams(fields).toString()})
  // Deliberately omit provider bodies, codes and tokens from errors/logs.
  if (!response.ok) throw new Error('commerce_token_exchange_failed')
  const data = await response.json()
  const seconds = Number(data.expires_in)
  if (typeof data.access_token !== 'string' || !data.access_token || String(data.token_type).toLowerCase() !== 'bearer'
      || !Number.isFinite(seconds) || seconds <= 0 || seconds > 366 * 86400) throw new Error('commerce_token_response_invalid')
  return {accessToken: data.access_token, expiresAt: Date.now() + seconds * 1000, scope: String(data.scope || '')}
}
