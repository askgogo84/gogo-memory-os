import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

const HTTP_URL_RE = /https?:\/\/[^\s"'<>]+/gi
const LONG_OPAQUE_TOKEN_RE = /\b[A-Za-z0-9+/_=-]{80,}\b/g

function redactUrl(raw: string) {
  try {
    const url = new URL(raw)
    if (url.username) url.username = '[redacted]'
    if (url.password) url.password = '[redacted]'
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, '[redacted]')
    }
    if (url.hash) url.hash = '#[redacted]'
    return url.toString()
  } catch {
    return '[sensitive url withheld]'
  }
}

/**
 * Redaction boundary for Secure Computer logs/errors/action summaries.
 *
 * Browser/provider URLs frequently contain one-time signatures, booking tokens,
 * session identifiers, or opaque authorization payloads whose names are not
 * predictable. For browser telemetry we therefore preserve only URL structure
 * and query parameter names, never their values. Long opaque/base64-like values
 * are also withheld in case a subprocess error echoes its encoded CLI payload.
 */
export function redactBrowserSensitiveText(content: string): string {
  if (!content) return content
  let out = redactSecretShapedText(String(content))
  out = out.replace(HTTP_URL_RE, (raw) => redactUrl(raw))
  out = out.replace(LONG_OPAQUE_TOKEN_RE, '[sensitive token withheld]')
  return out
}
