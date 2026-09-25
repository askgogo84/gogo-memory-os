export type DeliveryState = 'pending' | 'claimed' | 'provider_accepted' | 'delivered' | 'read' | 'failed' | 'suppressed' | 'cancelled' | 'outcome_unknown'

/** Acceptance is transport progress, never proof of recipient delivery. */
export function isVerifiedDelivery(state: string | null | undefined): boolean {
  return state === 'delivered' || state === 'read'
}

/** Only a definite rejection can permit another attempt. Network/5xx = unknown. */
export function isDefiniteProviderRejection(error: unknown): boolean {
  if ((error as { partialSend?: boolean })?.partialSend) return false
  const status = Number((error as { status?: number })?.status)
  return status >= 400 && status < 500 && status !== 408
}
