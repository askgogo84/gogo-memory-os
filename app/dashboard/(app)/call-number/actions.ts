'use server'

import { getSession } from '@/lib/dashboard/session'
import { generalCallPickerEnabled, proposeGeneralCallPhoneFromPlaces } from '@/lib/agent/general-call-places-phone'

export type PickerResult =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'found'; name: string; address: string; phone: string; mapUrl: string }

export async function lookUpBusinessNumber(_previous: PickerResult, form: FormData): Promise<PickerResult> {
  const session = await getSession()
  if (!generalCallPickerEnabled(session?.telegramId)) {
    return { kind: 'error', message: 'Business number lookup is unavailable for this account.' }
  }
  const businessName = form.get('businessName')
  const locality = form.get('locality')
  const placeId = form.get('placeId')
  if (typeof businessName !== 'string' || typeof locality !== 'string' || typeof placeId !== 'string') {
    return { kind: 'error', message: 'Enter the business name, locality and Place ID.' }
  }
  const candidate = await proposeGeneralCallPhoneFromPlaces({ businessName, locality, placeId: placeId.trim() })
  if (!candidate) {
    return { kind: 'error', message: 'I couldn’t match a number. Check the name, locality and Place ID, or reply in chat with a number you already know.' }
  }
  const { name, address, phone, mapUrl } = candidate
  return { kind: 'found', name, address, phone, mapUrl }
}
