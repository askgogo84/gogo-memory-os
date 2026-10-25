/**
 * The reminder delivery worker has the owner's persisted WhatsApp identity and
 * the destination selected for this reminder. A shared ten-digit suffix is
 * never sufficient to infer that these are the same person: e.g. a friend with
 * a different country code may have the same national number.
 *
 * Accept only already international, unambiguous addresses. In particular,
 * do NOT invent +91 for a domestic number or synthesize account identities.
 * Existing explicit "whatsapp:" and '+' transport decorations are tolerated.
 */
export function canonicalFullWhatsAppNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:/i, '')
  if (!/^\+?[1-9][0-9]{10,14}$/.test(raw)) return null
  return raw.startsWith('+') ? raw.slice(1) : raw
}

export function isReminderDestinationOwner(ownerWhatsAppId: unknown, destination: unknown): boolean {
  const owner = canonicalFullWhatsAppNumber(ownerWhatsAppId)
  const recipient = canonicalFullWhatsAppNumber(destination)
  return owner !== null && recipient !== null && owner === recipient
}
