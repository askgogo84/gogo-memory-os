/**
 * Provider-independent partner authorization and OAuth state contracts.
 * No provider URL, token exchange, customer session or network request exists here.
 * Only a trusted backend should implement the Source and Store interfaces.
 */
import {createHash, randomBytes} from 'node:crypto'

export type Partner = 'zomato' | 'district'
export type PartnerAction = 'discover' | 'menu' | 'availability' | 'cart_write' |
  'place_order' | 'book' | 'pay' | 'cancel' | 'refund'
export type TrustedPrincipal = {ownerId: string; tenantId: string}
export type PartnerGrant = {
  provider: Partner
  tenantId: string
  agreementRef: string
  partnerApproved: boolean
  oauthClientAllowlisted: boolean
  allowedActions: readonly PartnerAction[]
  allowedScopes: readonly string[]
  allowedRedirectUris: readonly string[]
  expiresAt: number
}
export type PartnerConsent = {
  provider: Partner
  ownerId: string
  tenantId: string
  scopes: readonly string[]
  grantedAt: number
  expiresAt: number
  revokedAt?: number | null
}
export interface PartnerAuthorizationSource {
  /** Read from trusted operator configuration, NOT LLM/client input. */
  loadGrant(tenantId: string, provider: Partner): Promise<PartnerGrant | null>
  /** Read from authenticated, encrypted owner-scoped account storage. */
  loadConsent(principal: TrustedPrincipal, provider: Partner): Promise<PartnerConsent | null>
}
export type PartnerBlockReason = 'invalid_principal' | 'provider_approval_required' |
  'oauth_client_not_approved' | 'partner_scope_denied' | 'consent_required' |
  'owner_mismatch' | 'invalid_oauth_state' | 'expired_oauth_state'
export class PartnerAccessError extends Error {
  constructor(readonly reason: PartnerBlockReason) { super(reason); this.name = 'PartnerAccessError' }
}
const validId = (value: unknown) => typeof value === 'string' &&
  /^[A-Za-z0-9._:@-]{1,160}$/.test(value)
const validScope = (s: unknown): s is string =>
  typeof s === 'string' && new RegExp('^[A-Za-z0-9:._/-]{1,128}' + '$').test(s)
const isPrincipal = (p: TrustedPrincipal): boolean =>
  !!p && validId(p.ownerId) && validId(p.tenantId)

function assertGrant(grant: PartnerGrant | null, principal: TrustedPrincipal, provider: Partner, now: number): asserts grant is PartnerGrant {
  if (!grant || grant.provider !== provider || grant.tenantId !== principal.tenantId ||
      !grant.partnerApproved || !validId(grant.agreementRef) || grant.expiresAt <= now)
    throw new PartnerAccessError('provider_approval_required')
  if (!grant.oauthClientAllowlisted) throw new PartnerAccessError('oauth_client_not_approved')
}
export async function requirePartnerGrant(
  source: PartnerAuthorizationSource, principal: TrustedPrincipal, provider: Partner,
  actions: readonly PartnerAction[], scopes: readonly string[], now = Date.now(),
): Promise<PartnerGrant> {
  if (!isPrincipal(principal)) throw new PartnerAccessError('invalid_principal')
  const grant = await source.loadGrant(principal.tenantId, provider)
  assertGrant(grant, principal, provider, now)
  if (!actions.every(action => grant.allowedActions.includes(action)) ||
      !scopes.length || !scopes.every(scope => validScope(scope) && grant.allowedScopes.includes(scope)))
    throw new PartnerAccessError('partner_scope_denied')
  return grant
}
export async function requirePartnerConsent(
  source: PartnerAuthorizationSource, principal: TrustedPrincipal, provider: Partner,
  action: PartnerAction, scopes: readonly string[], now = Date.now(),
): Promise<void> {
  await requirePartnerGrant(source, principal, provider, [action], scopes, now)
  const consent = await source.loadConsent(principal, provider)
  if (!consent || consent.revokedAt != null || consent.expiresAt <= now || consent.grantedAt > now)
    throw new PartnerAccessError('consent_required')
  if (consent.provider !== provider || consent.ownerId !== principal.ownerId || consent.tenantId !== principal.tenantId)
    throw new PartnerAccessError('owner_mismatch')
  if (!scopes.every(scope => consent.scopes.includes(scope)))
    throw new PartnerAccessError('consent_required')
}

export type OAuthPendingState = {
  stateHash: string
  ownerId: string
  tenantId: string
  provider: Partner
  scopes: readonly string[]
  redirectUri: string
  codeVerifier: string
  expiresAt: number
}
export interface PartnerOAuthStateStore {
  /** Persist hashed state with unique constraint before showing any provider auth URL. */
  putOnce(record: OAuthPendingState): Promise<boolean>
  /** Atomically consume/delete. Replays MUST return null, even across concurrent servers. */
  consume(stateHash: string): Promise<OAuthPendingState | null>
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** Server-side PKCE intent; does not invent an OAuth authorization endpoint. */
export async function issuePartnerOAuthIntent(args: {
  source: PartnerAuthorizationSource
  store: PartnerOAuthStateStore
  principal: TrustedPrincipal
  provider: Partner
  scopes: readonly string[]
  redirectUri: string
  now?: number
}): Promise<{state: string; codeChallenge: string; codeChallengeMethod: 'S256'; expiresAt: number}> {
  const now = args.now ?? Date.now()
  const grant = await requirePartnerGrant(args.source, args.principal, args.provider, ['discover'], args.scopes, now)
  if (!grant.allowedRedirectUris.includes(args.redirectUri) ||
      !/^https:\/\//.test(args.redirectUri))
    throw new PartnerAccessError('oauth_client_not_approved')
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')
  const expiresAt = Math.min(now + 10 * 60_000, grant.expiresAt)
  const ok = await args.store.putOnce({stateHash: sha256(state), ownerId: args.principal.ownerId,
    tenantId: args.principal.tenantId, provider: args.provider, scopes: [...args.scopes],
    redirectUri: args.redirectUri, codeVerifier, expiresAt})
  if (!ok) throw new PartnerAccessError('invalid_oauth_state')
  return {state, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    codeChallengeMethod: 'S256', expiresAt}
}
/**
 * Callback validation ONLY. Returns an exchange payload to a trusted server-side OAuth
 * broker; does not exchange the code, persist credentials or create consent itself.
 */
export async function consumePartnerOAuthCallback(args: {
  store: PartnerOAuthStateStore
  source: PartnerAuthorizationSource
  principal: TrustedPrincipal
  provider: Partner
  state: string
  code: string
  redirectUri: string
  now?: number
}): Promise<{code: string; codeVerifier: string; redirectUri: string; scopes: readonly string[]}> {
  if (!isPrincipal(args.principal) || !/^[A-Za-z0-9_-]{32,128}$/.test(args.state))
    throw new PartnerAccessError('invalid_oauth_state')
  const pending = await args.store.consume(sha256(args.state))
  if (!pending) throw new PartnerAccessError('invalid_oauth_state')
  if (pending.expiresAt <= (args.now ?? Date.now())) throw new PartnerAccessError('expired_oauth_state')
  if (pending.ownerId !== args.principal.ownerId || pending.tenantId !== args.principal.tenantId ||
      pending.provider !== args.provider || pending.redirectUri !== args.redirectUri)
    throw new PartnerAccessError('owner_mismatch')
  // Partner permissions may have been withdrawn after OAuth initiation. Fail closed.
  await requirePartnerGrant(args.source, args.principal, args.provider, ['discover'], pending.scopes, args.now ?? Date.now())
  if (typeof args.code !== 'string' || args.code.length < 1 || args.code.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(args.code)) throw new PartnerAccessError('invalid_oauth_state')
  return {code: args.code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri,
    scopes: [...pending.scopes]}
}
