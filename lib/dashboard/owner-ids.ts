// Service-role reads must never expand an authenticated actor through phone similarity.
// Verified cross-channel linking requires a separate explicit, independently verified link.
import { exactOwnerOnly } from './owner-identity'

export async function linkedTelegramIds(sessionTelegramId: string | number): Promise<string[]> {
  return exactOwnerOnly(sessionTelegramId)
}

/** Legacy compatibility: raw WhatsApp identifiers cannot authorize an account lookup. */
export async function idsForWhatsapp(_whatsappId: string | null | undefined): Promise<string[]> {
  return []
}
