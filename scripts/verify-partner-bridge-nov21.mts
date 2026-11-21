/** Synthetic-only partner authorization, OAuth and transaction tests. No network. */
import assert from 'node:assert/strict'
import {
  type PartnerAuthorizationSource, type PartnerGrant, type PartnerConsent,
  type PartnerOAuthStateStore, type OAuthPendingState,
  PartnerAccessError, requirePartnerGrant, requirePartnerConsent,
  issuePartnerOAuthIntent, consumePartnerOAuthCallback,
} from '../lib/commerce/partner-bridge/authorizations.ts'
import {
  type DurablePartnerAction, type DurablePartnerActionStore,
  type ExactQuote, type ApprovedProviderAdapter, type VerifiedReadback,
  PartnerActionError, quoteDigest, preparePartnerAction, approvePartnerAction,
  dispatchPartnerAction, reconcilePartnerAction,
} from '../lib/commerce/partner-bridge/action-ledger.ts'

const now = 1_800_000_000_000
const principal = {ownerId: 'owner-A', tenantId: 'tenant-1'}
const other = {ownerId: 'owner-B', tenantId: 'tenant-1'}
const callback = 'https://app.askgogo.in/api/integrations/zomato/callback'
let count = 0
function eq(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); count++ }
async function blocked(fn: () => unknown, reason: string) {
  await assert.rejects(async () => fn(), (e: any) =>
    (e instanceof PartnerAccessError || e instanceof PartnerActionError) &&
    e.reason === reason, reason)
  count++
}
const grant: PartnerGrant = {
  provider: 'zomato', tenantId: 'tenant-1', agreementRef: 'agreement-1',
  partnerApproved: true, oauthClientAllowlisted: true,
  allowedActions: ['discover', 'menu', 'place_order', 'pay'],
  allowedScopes: ['read:restaurant', 'write:orders'],
  allowedRedirectUris: [callback], expiresAt: now + 3600_000,
}
const consent: PartnerConsent = {
  provider: 'zomato', ownerId: principal.ownerId, tenantId: principal.tenantId,
  scopes: ['read:restaurant', 'write:orders'], grantedAt: now - 1000,
  expiresAt: now + 3600_000, revokedAt: null,
}
let currentGrant: PartnerGrant | null = grant
let currentConsent: PartnerConsent | null = consent
const source: PartnerAuthorizationSource = {
  async loadGrant() { return currentGrant },
  async loadConsent() { return currentConsent },
}
const states = new Map<string, OAuthPendingState>()
const oauthStore: PartnerOAuthStateStore = {
  async putOnce(record) {
    if (states.has(record.stateHash)) return false
    states.set(record.stateHash, structuredClone(record)); return true
  },
  async consume(key) {
    const result = states.get(key) || null
    states.delete(key); return result
  },
}
eq((await requirePartnerGrant(source, principal, 'zomato', ['discover'], ['read:restaurant'], now)).agreementRef,
  'agreement-1')
await requirePartnerConsent(source, principal, 'zomato', 'place_order', ['write:orders'], now)
count++
currentGrant = {...grant, partnerApproved: false}
await blocked(() => requirePartnerGrant(source, principal, 'zomato', ['discover'], ['read:restaurant'], now), 'provider_approval_required')
currentGrant = {...grant, oauthClientAllowlisted: false}
await blocked(() => requirePartnerGrant(source, principal, 'zomato', ['discover'], ['read:restaurant'], now), 'oauth_client_not_approved')
currentGrant = grant
await blocked(() => requirePartnerGrant(source, principal, 'zomato', ['refund'], ['write:orders'], now), 'partner_scope_denied')
await blocked(() => requirePartnerGrant(source, principal, 'zomato', ['discover'], ['unknown'], now), 'partner_scope_denied')
await blocked(() => requirePartnerGrant(source, {...principal, ownerId: '../'}, 'zomato', ['discover'], ['read:restaurant'], now), 'invalid_principal')
currentConsent = null
await blocked(() => requirePartnerConsent(source, principal, 'zomato', 'place_order', ['write:orders'], now), 'consent_required')
currentConsent = {...consent, revokedAt: now - 1}
await blocked(() => requirePartnerConsent(source, principal, 'zomato', 'place_order', ['write:orders'], now), 'consent_required')
currentConsent = {...consent, ownerId: other.ownerId}
await blocked(() => requirePartnerConsent(source, principal, 'zomato', 'place_order', ['write:orders'], now), 'owner_mismatch')
currentConsent = consent
await blocked(() => issuePartnerOAuthIntent({source, store: oauthStore, principal, provider: 'zomato',
  scopes: ['read:restaurant'], redirectUri: 'https://evil.example/cb', now}), 'oauth_client_not_approved')
const oauth = await issuePartnerOAuthIntent({source, store: oauthStore, principal,
  provider: 'zomato', scopes: ['read:restaurant'], redirectUri: callback, now})
eq(oauth.codeChallengeMethod, 'S256')
eq(oauth.codeChallenge.length > 35, true)
eq(oauth.state.length > 35, true)
eq(oauth.expiresAt, now + 600_000)
await blocked(() => consumePartnerOAuthCallback({source, store: oauthStore, principal: other,
  provider: 'zomato', state: oauth.state, code: 'mock-code', redirectUri: callback, now}), 'owner_mismatch')
// Deliberately consumed on wrong owner; state is one-time even on rejection.
await blocked(() => consumePartnerOAuthCallback({source, store: oauthStore, principal,
  provider: 'zomato', state: oauth.state, code: 'mock-code', redirectUri: callback, now}), 'invalid_oauth_state')
const oauth2 = await issuePartnerOAuthIntent({source, store: oauthStore, principal,
  provider: 'zomato', scopes: ['read:restaurant'], redirectUri: callback, now})
const finalized = await consumePartnerOAuthCallback({source, store: oauthStore, principal,
  provider: 'zomato', state: oauth2.state, code: 'mock-code', redirectUri: callback, now})
eq(finalized.code, 'mock-code')
eq(finalized.scopes, ['read:restaurant'])
eq(finalized.codeVerifier.length > 40, true)
await blocked(() => consumePartnerOAuthCallback({source, store: oauthStore, principal,
  provider: 'zomato', state: oauth2.state, code: 'mock-code', redirectUri: callback, now}), 'invalid_oauth_state')
const oauth3 = await issuePartnerOAuthIntent({source, store: oauthStore, principal,
  provider: 'zomato', scopes: ['read:restaurant'], redirectUri: callback, now})
await blocked(() => consumePartnerOAuthCallback({source, store: oauthStore, principal,
  provider: 'zomato', state: oauth3.state, code: 'mock-code', redirectUri: callback, now: now + 601_000}),
  'expired_oauth_state')

class MockStore implements DurablePartnerActionStore {
  private readonly map = new Map<string, DurablePartnerAction>()
  async insertIfAbsent(a: DurablePartnerAction) {
    if (this.map.has(a.id)) return false
    this.map.set(a.id, structuredClone(a)); return true
  }
  async get(id: string) { return structuredClone(this.map.get(id) || null) }
  async compareAndSwap(id: string, rev: number, next: DurablePartnerAction) {
    if (this.map.get(id)?.revision !== rev || next.revision !== rev + 1) return false
    this.map.set(id, structuredClone(next)); return true
  }
}
const quote: ExactQuote = {
  provider: 'zomato', ownerId: principal.ownerId, tenantId: principal.tenantId,
  action: 'place_order', merchantId: 'restaurant-1', outletId: 'outlet-1',
  fulfilmentRef: 'delivery-address-1', providerQuoteRef: 'quote-1',
  lines: [{sku: 'meal-1', title: 'Masala dosa', quantity: 2, unitPriceMinor: 15000}],
  taxesMinor: 1000, feesMinor: 2000, discountsMinor: 1000,
  totalMinor: 32000, currency: 'INR', expiresAt: now + 300_000,
}
const store = new MockStore()
const create = (id: string, q: ExactQuote = quote, p = principal) =>
  preparePartnerAction({store, source, principal: p, id, quote: q,
    requiredScopes: ['write:orders'], now})
const pending = await create('order-1')
eq(pending.stage, 'awaiting_approval')
eq(pending.quoteDigest, quoteDigest(quote))
eq((await store.get('order-1'))?.revision, 0)
await blocked(() => create('order-1'), 'conflict')
await blocked(() => create('order-bad-total', {...quote, totalMinor: 1}), 'invalid_quote')
await blocked(() => create('order-expired', {...quote, expiresAt: now - 1}), 'invalid_quote')
await blocked(() => create('order-wrong-owner', quote, other), 'owner_mismatch')
await blocked(() => approvePartnerAction({store, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, confirmed: false, now}), 'approval_required')
await blocked(() => approvePartnerAction({store, principal, id: 'order-1',
  displayedQuoteDigest: 'not-the-display', confirmed: true, now}), 'stale_quote')
await blocked(() => approvePartnerAction({store, principal: other, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, confirmed: true, now}), 'owner_mismatch')
const approved = await approvePartnerAction({store, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, confirmed: true, now})
eq(approved.stage, 'approved')
await blocked(() => approvePartnerAction({store, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, confirmed: true, now}), 'approval_required')
let submits = 0
let readbacks = 0
let fixture: VerifiedReadback | null = null
let rejectSubmit = false
const adapter: ApprovedProviderAdapter = {
  async submitApproved() {
    submits++
    if (rejectSubmit) throw new Error('ambiguous connection reset')
    return {httpStatus: 200, accepted: true} // NOT proof of real completion
  },
  async readback() { readbacks++; return fixture },
}
await blocked(() => dispatchPartnerAction({store, source, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, controls: {authorizedWriteEnabled: false, operatorApproved: true},
  adapter, now}), 'operator_disabled')
eq(submits, 0)
await blocked(() => dispatchPartnerAction({store, source, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, controls: {authorizedWriteEnabled: true, operatorApproved: false},
  adapter, now}), 'operator_disabled')
eq(submits, 0)
currentConsent = {...consent, revokedAt: now}
await blocked(() => dispatchPartnerAction({store, source, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, controls: {authorizedWriteEnabled: true, operatorApproved: true},
  adapter, now}), 'consent_required')
eq(submits, 0)
currentConsent = consent
const unknown = await dispatchPartnerAction({store, source, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, controls: {authorizedWriteEnabled: true, operatorApproved: true},
  adapter, now})
eq(unknown.stage, 'outcome_unknown')
eq(submits, 1)
await blocked(() => dispatchPartnerAction({store, source, principal, id: 'order-1',
  displayedQuoteDigest: pending.quoteDigest, controls: {authorizedWriteEnabled: true, operatorApproved: true},
  adapter, now}), 'already_submitted')
eq(submits, 1)
eq((await reconcilePartnerAction({store, principal, id: 'order-1', adapter})).stage, 'outcome_unknown')
eq(readbacks, 1)
fixture = {source: 'authenticated_provider_readback', provider: 'zomato',
  ownerId: principal.ownerId, tenantId: principal.tenantId, actionId: 'order-1',
  quoteDigest: pending.quoteDigest, finalState: 'completed',
  providerTransactionRef: 'provider-order-1', evidenceRef: 'readback-1',
  currency: 'INR', totalMinor: 32000}
await blocked(() => reconcilePartnerAction({store, principal: other, id: 'order-1', adapter}), 'owner_mismatch')
fixture = {...fixture, totalMinor: 31999}
await blocked(() => reconcilePartnerAction({store, principal, id: 'order-1', adapter}), 'unverified_readback')
fixture = {...fixture, totalMinor: 32000}
eq((await reconcilePartnerAction({store, principal, id: 'order-1', adapter})).stage, 'verified_success')
eq((await reconcilePartnerAction({store, principal, id: 'order-1', adapter})).evidenceRef, 'readback-1')
eq(submits, 1)
const pending2 = await create('order-2')
await approvePartnerAction({store, principal, id: 'order-2', displayedQuoteDigest: pending2.quoteDigest,
  confirmed: true, now})
rejectSubmit = true
eq((await dispatchPartnerAction({store, source, principal, id: 'order-2',
  displayedQuoteDigest: pending2.quoteDigest, controls: {authorizedWriteEnabled: true, operatorApproved: true},
  adapter, now})).stage, 'outcome_unknown')
eq(submits, 2)
fixture = {...fixture, actionId: 'order-2', finalState: 'failed', evidenceRef: 'readback-failure-2',
  providerTransactionRef: 'provider-ref-2'}
eq((await reconcilePartnerAction({store, principal, id: 'order-2', adapter})).stage, 'verified_failure')
eq(submits, 2)
console.log('PASS partner-bridge OAuth, consent, no-retry and reconciliation: ' + count +
  ' fixture assertions (zero provider requests)')
