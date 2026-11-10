// Which WhatsApp provider carries a message: Twilio (today, and the default) or Meta Cloud API directly.
// Plan: docs/architecture/whatsapp-twilio-to-meta-migration.md. Meta is used only when its credentials are present AND
// either GOGO_WA_PROVIDER=meta, or the recipient is on the pilot list GOGO_WA_META_NUMBERS. Anything else is Twilio.
export type WaProvider = 'twilio' | 'meta'
type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env

/** Digits of a WhatsApp address, as a string. Phone numbers are never turned into JavaScript numbers. */
export function waDigits(value: unknown): string {
  return String(value ?? '').replace(/^whatsapp:/i, '').replace(/\D/g, '')
}

export function metaWaConfigured(env: Env = envOf()): boolean {
  return Boolean((env.GOGO_META_WA_TOKEN || '').trim() && /^\d{5,20}$/.test((env.GOGO_META_WA_PHONE_ID || '').trim()))
}

/** Pilot recipients: comma-separated numbers in international format. Exact match on the full digit string. */
export function metaPilotNumbers(env: Env = envOf()): string[] {
  return String(env.GOGO_WA_META_NUMBERS || '').split(',').map(waDigits).filter(d => d.length >= 8 && d.length <= 15)
}

export function waProviderFor(to: unknown, env: Env = envOf()): WaProvider {
  if (!metaWaConfigured(env)) return 'twilio'
  if ((env.GOGO_WA_PROVIDER || '').trim().toLowerCase() === 'meta') return 'meta'
  const digits = waDigits(to)
  return digits && metaPilotNumbers(env).includes(digits) ? 'meta' : 'twilio'
}

/** A Meta message id (wamid) as opposed to a Twilio SID. Decides which API a typing indicator or status lookup uses. */
export function isMetaMessageId(id: unknown): boolean {
  return /^wamid\.[A-Za-z0-9+/=_-]{8,}$/.test(String(id ?? '').trim())
}
