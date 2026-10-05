// Only a failed, non-consequential browser action with a confirmed pointer
// interception can be offered for a read-only human takeover. An uncertain
// submit must continue through outcome reconciliation instead.
export function needsHumanPageInteraction(actions: unknown): boolean {
  return Array.isArray(actions) && actions.some(action =>
    action?.status === 'failed'
      && action?.failure?.reason === 'obscured'
      && action?.consequential !== true)
}
