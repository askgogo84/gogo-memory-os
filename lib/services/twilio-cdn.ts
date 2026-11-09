// One definition of "Twilio's media CDN" for every credential-free redirect hop after an authenticated
// api.twilio.com media request. Hotfix 9 Nov: five helpers each accepted only https://mms.twiliocdn.com, and a
// rejection returned null with no log, so a different Twilio CDN form would make voice notes and photos fail
// silently. Accepted, all HTTPS with no userinfo or fragment and a non-root path:
//   · mms.twiliocdn.com and any other *.twiliocdn.com host (a Twilio-owned zone)
//   · Twilio's S3 bucket media.twiliocdn.com, path-style (s3*.amazonaws.com/media.twiliocdn.com/…) or virtual-hosted
// The hop never carries Twilio credentials; this check is defence in depth on a Location that came from Twilio.
const S3_PATH_HOST = /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/
export function isTwilioMediaCdnUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false
  if (!url.pathname || url.pathname === '/') return false
  const host = url.hostname.toLowerCase()
  if (host === 'twiliocdn.com' || host.endsWith('.twiliocdn.com')) return true
  if (S3_PATH_HOST.test(host) && url.pathname.startsWith('/media.twiliocdn.com/')) return true
  if (/^media\.twiliocdn\.com\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host)) return true
  return false
}

/** Logs only the host (never the path, query or credentials) so a new Twilio CDN form is visible, not silent. */
export function logRejectedTwilioRedirect(where: string, location: string | null | undefined) {
  let host = 'unparseable'
  try { host = new URL(String(location || '')).hostname || 'none' } catch { /* keep */ }
  console.error('TWILIO_MEDIA_REDIRECT_REJECTED:', JSON.stringify({ where, host }))
}
