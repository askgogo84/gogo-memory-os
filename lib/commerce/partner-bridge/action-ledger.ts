/**
 * Durable, provider-agnostic consequential action coordinator.
 * Absolutely no Zomato/District transport or production wiring is installed.
 *
 * Atomic CAS and the unique action key MUST be implemented by a persistent
 * transactional backend before this can be connected to a provider.
 */
import {createHash} from 'node:crypto'
import {
  requirePartnerConsent, type Partner, type PartnerAction,
  type PartnerAuthorizationSource, type TrustedPrincipal,
} from './authorizations'

export type WriteAction = Extract<PartnerAction, 'cart_write' | 'place_order' | 'book' | 'pay' | 'cancel' | 'refund'>
export type PricedLine = {sku: string; title: string; quantity: number; unitPriceMinor: number}
export type ExactQuote = {
  provider: Partner
  ownerId: string
  tenantId: string
  action: WriteAction
  merchantId: string
  outletId: string
  fulfilmentRef: string
  providerQuoteRef: string
  lines: readonly PricedLine[]
  taxesMinor: number
  feesMinor: number
  discountsMinor: number
  totalMinor: number
  currency: 'INR'
  expiresAt: number
}
export type ActionStage = 'awaiting_approval' | 'approved' | 'submission_reserved' |
  'outcome_unknown' | 'verified_success' | 'verified_failure'
export type DurablePartnerAction = {
  id: string
  principal: TrustedPrincipal
  quote: ExactQuote
  quoteDigest: string
  requiredScopes: readonly string[]
  stage: ActionStage
  revision: number
  createdAt: number
  approvedAt?: number
  approvedBy?: string
  evidenceRef?: string
  providerTransactionRef?: string
}
export interface DurablePartnerActionStore {
  /** Unique id per attempt, transactional insert; FALSE on duplicate. */
  insertIfAbsent(action: DurablePartnerAction): Promise<boolean>
  get(id: string): Promise<DurablePartnerAction | null>
  /** Atomic version compare-and-swap; should reject stale mutations. */
  compareAndSwap(id: string, expectedRevision: number, next: DurablePartnerAction): Promise<boolean>
}
export type TrustedExecutionControls = {
  /** Must originate from operator secrets; both OFF by default. */
  authorizedWriteEnabled: boolean
  operatorApproved: boolean
}
export interface ApprovedProviderAdapter {
  /** Must be vendor-reviewed and fixed to one explicit operation, never arbitrary MCP tools/call. */
  submitApproved(quote: Readonly<ExactQuote>, idempotencyKey: string): Promise<unknown>
  /** Must be an independently authenticated provider readback. */
  readback(quote: Readonly<ExactQuote>, idempotencyKey: string): Promise<VerifiedReadback | null>
}
export type VerifiedReadback = {
  source: 'authenticated_provider_readback'
  provider: Partner
  ownerId: string
  tenantId: string
  actionId: string
  quoteDigest: string
  finalState: 'completed' | 'failed' | 'pending'
  providerTransactionRef: string
  evidenceRef: string
  currency: 'INR'
  totalMinor: number
}
export type ActionBlock = 'invalid_quote' | 'not_found' | 'owner_mismatch' |
  'stale_quote' | 'approval_required' | 'already_submitted' | 'operator_disabled' |
  'conflict' | 'unverified_readback'
export class PartnerActionError extends Error {
  constructor(readonly reason: ActionBlock) { super(reason); this.name = 'PartnerActionError' }
}
const minor = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const clean = (s: unknown, max: number) => typeof s === 'string' &&
  s.trim().length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s)
const writeActions: readonly PartnerAction[] = ['cart_write', 'place_order', 'book', 'pay', 'cancel', 'refund']
function checkedQuote(quote: ExactQuote, now: number) {
  if (!quote || !(['zomato', 'district'] as string[]).includes(quote.provider) ||
      !writeActions.includes(quote.action) || quote.currency !== 'INR' ||
      !clean(quote.ownerId, 160) || !clean(quote.tenantId, 160) ||
      !clean(quote.merchantId, 256) || !clean(quote.outletId, 256) ||
      !clean(quote.fulfilmentRef, 256) || !clean(quote.providerQuoteRef, 256) ||
      !Array.isArray(quote.lines) || quote.lines.length < 1 || quote.lines.length > 100 ||
      !quote.lines.every(line => clean(line.sku, 256) && clean(line.title, 256) &&
        Number.isSafeInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 999 &&
        minor(line.unitPriceMinor)) ||
      !minor(quote.taxesMinor) || !minor(quote.feesMinor) ||
      !minor(quote.discountsMinor) || !minor(quote.totalMinor) ||
      quote.totalMinor < 1 || !Number.isFinite(quote.expiresAt) || quote.expiresAt <= now ||
      quote.expiresAt > now + 24 * 60 * 60_000)
    throw new PartnerActionError('invalid_quote')
  // Must be the EXACT provider-verified total, not a synthetic client estimate;
  // component math still catches common tampering and mismatched totals.
  const subtotal = quote.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0)
  const recomputedTotal = subtotal + quote.taxesMinor + quote.feesMinor - quote.discountsMinor
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(recomputedTotal) ||
      recomputedTotal !== quote.totalMinor)
    throw new PartnerActionError('invalid_quote')
}
export function quoteDigest(quote: ExactQuote): string {
  return createHash('sha256').update(JSON.stringify([
    quote.provider, quote.ownerId, quote.tenantId, quote.action, quote.merchantId,
    quote.outletId, quote.fulfilmentRef, quote.providerQuoteRef, quote.lines.map(line =>
      [line.sku, line.title, line.quantity, line.unitPriceMinor]),
    quote.taxesMinor, quote.feesMinor, quote.discountsMinor, quote.totalMinor,
    quote.currency, quote.expiresAt,
  ])).digest('hex')
}
function assertOwned(action: DurablePartnerAction | null, principal: TrustedPrincipal): asserts action is DurablePartnerAction {
  if (!action) throw new PartnerActionError('not_found')
  if (action.principal.ownerId !== principal.ownerId || action.principal.tenantId !== principal.tenantId ||
      action.quote.ownerId !== principal.ownerId || action.quote.tenantId !== principal.tenantId)
    throw new PartnerActionError('owner_mismatch')
}
const currentDigest = (a: DurablePartnerAction) => quoteDigest(a.quote) === a.quoteDigest
const replaceStage = (a: DurablePartnerAction, stage: ActionStage, fields: Partial<DurablePartnerAction> = {}):
  DurablePartnerAction => ({...a, ...fields, stage, revision: a.revision + 1})

export async function preparePartnerAction(input: {
  store: DurablePartnerActionStore
  source: PartnerAuthorizationSource
  principal: TrustedPrincipal
  id: string
  quote: ExactQuote
  requiredScopes: readonly string[]
  now?: number
}): Promise<DurablePartnerAction> {
  const now = input.now ?? Date.now()
  checkedQuote(input.quote, now)
  if (!clean(input.id, 160) || input.quote.ownerId !== input.principal.ownerId ||
      input.quote.tenantId !== input.principal.tenantId)
    throw new PartnerActionError('owner_mismatch')
  await requirePartnerConsent(input.source, input.principal, input.quote.provider,
    input.quote.action, input.requiredScopes, now)
  const record: DurablePartnerAction = {id: input.id, principal: {...input.principal},
    quote: structuredClone(input.quote), quoteDigest: quoteDigest(input.quote),
    requiredScopes: [...input.requiredScopes], stage: 'awaiting_approval', revision: 0, createdAt: now}
  if (!await input.store.insertIfAbsent(record)) throw new PartnerActionError('conflict')
  return record
}
/** Explicit user approval must submit the displayed digest, never simply 'yes' to an old quote. */
export async function approvePartnerAction(input: {
  store: DurablePartnerActionStore; principal: TrustedPrincipal
  id: string; displayedQuoteDigest: string; confirmed: boolean; now?: number
}): Promise<DurablePartnerAction> {
  const a = await input.store.get(input.id)
  assertOwned(a, input.principal)
  const now = input.now ?? Date.now()
  if (!input.confirmed || a.stage !== 'awaiting_approval')
    throw new PartnerActionError('approval_required')
  if (!currentDigest(a) || a.quoteDigest !== input.displayedQuoteDigest || a.quote.expiresAt <= now)
    throw new PartnerActionError('stale_quote')
  const next = replaceStage(a, 'approved', {approvedAt: now, approvedBy: input.principal.ownerId})
  if (!await input.store.compareAndSwap(a.id, a.revision, next)) throw new PartnerActionError('conflict')
  return next
}
/**
 * Reserved *before* the only possible send. Once reserved, crashes/timeouts
 * imply UNKNOWN, never automatic resubmission. A provider receipt/readback is
 * required for verified success. There are NO production adapter instances.
 */
export async function dispatchPartnerAction(input: {
  store: DurablePartnerActionStore; source: PartnerAuthorizationSource
  principal: TrustedPrincipal; id: string; displayedQuoteDigest: string
  controls: TrustedExecutionControls; adapter: ApprovedProviderAdapter
  now?: number
}): Promise<DurablePartnerAction> {
  const a = await input.store.get(input.id)
  assertOwned(a, input.principal)
  const now = input.now ?? Date.now()
  if (!input.controls.authorizedWriteEnabled || !input.controls.operatorApproved)
    throw new PartnerActionError('operator_disabled')
  if (a.stage !== 'approved' || a.approvedBy !== input.principal.ownerId)
    throw new PartnerActionError('already_submitted')
  if (a.quote.expiresAt <= now || !currentDigest(a) || a.quoteDigest !== input.displayedQuoteDigest)
    throw new PartnerActionError('stale_quote')
  await requirePartnerConsent(input.source, input.principal, a.quote.provider,
    a.quote.action, a.requiredScopes, now)
  const reserved = replaceStage(a, 'submission_reserved')
  if (!await input.store.compareAndSwap(a.id, a.revision, reserved))
    throw new PartnerActionError('conflict')
  // No success is inferred from a successful HTTP response or MCP tools/call.
  try { await input.adapter.submitApproved(structuredClone(a.quote), a.id) }
  catch { /* Errors after reservation have unknown side effects. */ }
  const unknown = replaceStage(reserved, 'outcome_unknown')
  if (!await input.store.compareAndSwap(a.id, reserved.revision, unknown))
    throw new PartnerActionError('conflict')
  return unknown
}
export async function reconcilePartnerAction(input: {
  store: DurablePartnerActionStore; principal: TrustedPrincipal
  id: string; adapter: ApprovedProviderAdapter
}): Promise<DurablePartnerAction> {
  const a = await input.store.get(input.id)
  assertOwned(a, input.principal)
  if (a.stage === 'verified_success' || a.stage === 'verified_failure') return a
  if (a.stage !== 'outcome_unknown' && a.stage !== 'submission_reserved')
    throw new PartnerActionError('approval_required')
  // Readback only, never call submit again, including a crash after reservation.
  let e: VerifiedReadback | null
  try { e = await input.adapter.readback(structuredClone(a.quote), a.id) }
  catch { return a }
  if (!e || e.finalState === 'pending') return a
  if (!['completed', 'failed'].includes(e.finalState) ||
      e.source !== 'authenticated_provider_readback' || e.provider !== a.quote.provider ||
      e.ownerId !== a.principal.ownerId || e.tenantId !== a.principal.tenantId ||
      e.actionId !== a.id || e.quoteDigest !== a.quoteDigest ||
      e.currency !== a.quote.currency || e.totalMinor !== a.quote.totalMinor ||
      !clean(e.evidenceRef, 512) || !clean(e.providerTransactionRef, 512))
    throw new PartnerActionError('unverified_readback')
  const next = replaceStage(a, e.finalState === 'completed' ? 'verified_success' : 'verified_failure', {
    evidenceRef: e.evidenceRef, providerTransactionRef: e.providerTransactionRef,
  })
  if (!await input.store.compareAndSwap(a.id, a.revision, next)) throw new PartnerActionError('conflict')
  return next
}
