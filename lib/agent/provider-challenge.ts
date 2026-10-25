export const PROVIDER_CLOUDFLARE_CHALLENGE = 'provider_cloudflare_challenge' as const
export const DEVICE_HANDOFF_REQUIRED = 'device_handoff_required' as const

export type ProviderChallengeResult = {
  challenged: boolean
  reason?: typeof PROVIDER_CLOUDFLARE_CHALLENGE
}

function normalized(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function detectProviderChallenge(input: { title?: unknown; text?: unknown }): ProviderChallengeResult {
  const title = normalized(input.title)
  const text = normalized(input.text)
  const combined = `${title} ${text}`

  const cloudflareSignals = [
    /attention required!\s*\|\s*cloudflare/i,
    /sorry, you have been blocked/i,
    /you have been blocked/i,
    /cloudflare ray id/i,
    /please enable cookies/i,
    /performance & security by cloudflare/i,
  ]

  if (cloudflareSignals.some((pattern) => pattern.test(combined))) {
    return { challenged: true, reason: PROVIDER_CLOUDFLARE_CHALLENGE }
  }

  return { challenged: false }
}
