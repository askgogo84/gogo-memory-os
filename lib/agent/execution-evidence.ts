// Evidence is emitted by trusted provider adapters after exact-object read-back,
// never parsed from user text, model prose, HTTP status or a returned mutation ID.
export type ExecutionEvidence = {
  source: 'gmail' | 'google_calendar' | 'browser' | 'travel'
  kind: 'provider_readback' | 'provider_receipt'
  objectRef: string
  providerRef: string
  verified: boolean
}

export function hasExecutionEvidence(handler: string, objectRef?: string | null, evidence?: ExecutionEvidence): boolean | null {
  const source = handler === 'gmail-send' ? 'gmail'
    : /^calendar-(?:create|update)$/.test(handler) ? 'google_calendar'
    : /browser/.test(handler) ? 'browser'
    : /book|checkout|payment|purchase|checkin/.test(handler) ? 'travel' : null
  if (!source && !/send|submit|execute|mutation/.test(handler)) return null
  return !!evidence && evidence.verified === true && !!source && evidence.source === source
    && ['provider_readback', 'provider_receipt'].includes(evidence.kind)
    && !!objectRef && evidence.objectRef === objectRef && !!evidence.providerRef?.trim()
}
