import { Platform } from 'react-native'
import { saveMobileSession } from './session'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export type MobileLinkRequest = {
  linkId: string
  code: string
  pollToken: string
  expiresAt: string
  whatsappMessage: string
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(json?.error || `request_failed_${response.status}`)
  return json as T
}

export function mobilePlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android'
}

export async function startWhatsAppLink(params: { deviceId?: string; deviceName?: string } = {}) {
  return post<MobileLinkRequest>('/api/mobile/link/start', {
    platform: mobilePlatform(),
    deviceId: params.deviceId || '',
    deviceName: params.deviceName || '',
  })
}

export async function getWhatsAppLinkStatus(pollToken: string) {
  return post<{ status: 'pending' | 'approved' | 'exchanged' | 'expired'; approvedAt?: string | null; expiresAt?: string }>(
    '/api/mobile/link/status',
    { pollToken },
  )
}

export async function exchangeWhatsAppLink(params: {
  pollToken: string
  deviceId?: string
  deviceName?: string
}) {
  const session = await post<{ accessToken: string; sessionId: string; expiresAt: string }>(
    '/api/mobile/session/exchange',
    {
      pollToken: params.pollToken,
      platform: mobilePlatform(),
      deviceId: params.deviceId || '',
      deviceName: params.deviceName || '',
    },
  )
  await saveMobileSession(session.accessToken, session.expiresAt)
  return session
}
