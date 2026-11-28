'use client'

/**
 * Presentational-only consent review for the future partner onboarding flow.
 * Intentionally not mounted in any route. No OAuth URL, token, callback, order,
 * booking or payment action is available before partner authorization.
 */
import type {Partner} from '@/lib/commerce/partner-bridge/authorizations'

type ConsentReviewProps = {
  provider: Partner
  requestedScopes: readonly string[]
  status?: 'awaiting_partner' | 'not_connected' | 'connected' | 'revoked'
  onStartApprovedConnection?: () => void
  onRequestRevocation?: () => void
  /** Only supplied by verified server-side authorization and consent state. */
  approvedForConnection?: boolean
}
export function PartnerConsentReview({
  provider, requestedScopes, status = 'awaiting_partner', approvedForConnection = false,
  onStartApprovedConnection, onRequestRevocation,
}: ConsentReviewProps) {
  const providerName = provider === 'zomato' ? 'Zomato' : 'District'
  const canConnect = approvedForConnection && status === 'not_connected' &&
    typeof onStartApprovedConnection === 'function'
  const canRevoke = status === 'connected' && typeof onRequestRevocation === 'function'
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900"
      aria-label={providerName + ' connection review'}>
      <h2 className="text-lg font-semibold">Connect {providerName} to AskGogo</h2>
      <p className="mt-2 text-sm text-zinc-700">
        AskGogo will only access the account information and actions you explicitly approve.
        Connecting an account never authorizes a purchase, payment, booking or cancellation.
      </p>
      <h3 className="mt-4 text-sm font-semibold">Requested permissions</h3>
      <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
        {requestedScopes.length ? requestedScopes.map(scope => <li key={scope}>{scope}</li>) :
          <li>No permissions available until the provider confirms approved scopes.</li>}
      </ul>
      <p className="mt-3 text-sm text-zinc-700">
        Every consequential action requires a separate review of the exact merchant, items,
        total, fees and fulfilment details. Uncertain transaction outcomes are not retried.
        You may disconnect or withdraw consent.
      </p>
      <p className="mt-3 text-sm font-medium" role="status">
        {status === 'connected' ? 'Connected — manage permissions or disconnect below.' :
          status === 'revoked' ? 'Connection revoked.' :
          status === 'not_connected' && canConnect ? 'Provider-approved connection available.' :
          'Awaiting the provider’s commercial and OAuth approval.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={!canConnect}
          onClick={canConnect ? onStartApprovedConnection : undefined}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
          Connect {providerName}
        </button>
        <button type="button" disabled={!canRevoke}
          onClick={canRevoke ? onRequestRevocation : undefined}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">
          Disconnect
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        No provider account is connected by viewing this screen. Authenticated user identity,
        approved scopes and revocation must be verified server-side.
      </p>
    </section>
  )
}
