// "Make a one-page brief on …", "Create a report on …": a Make deliverable (saved in Make), not a chat answer.
// Shared by the planner and the understand-first dispatcher so neither answers it inline (23 Oct live).
export const MAKE_DELIVERABLE_RE = /^(?:please\s+|can you\s+|could you\s+)?(?:make|create|write|prepare|build|put together|draw up|produce)\s+(?:me\s+)?(?:a|an|the|my)?\s*(?:short\s+|quick\s+|detailed\s+|one[- ]page\s+|1[- ]page\s+|\d{1,2}[- ]?(?:slide|page|day)s?\s+)?(?:research\s+|pitch\s+|budget\s+|travel\s+|trip\s+)?(?:brief|report|one[- ]pager|comparison(?:\s+table)?|summary\s+report|tracker|guide|checklist|deck(?:\s+outline)?|presentation|slides?|slide\s+deck|sheet|spreadsheet|budget|itinerary|proposal|memo)\b/i

export function isMakeDeliverableRequest(text: string): boolean {
  const t = String(text || '').trim()
  return MAKE_DELIVERABLE_RE.test(t) && !/\b(?:e-?mail|message|whatsapp|text|reply)\b/i.test(t)
}
