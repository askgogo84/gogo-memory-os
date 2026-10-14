// How a Gmail result reads in chat. "What's the latest email from Google?" asks for one email, not a list;
// dates come back from Gmail in the sender's zone ("Thu, 08 Oct 2026 08:44:39 -0700") and should read in IST;
// snippets carry newsletter boilerplate ("Email not displaying correctly? View it online").

/** One email wanted: "the latest/last/most recent/newest email" (singular), not "latest emails". */
export function wantsSingleLatestEmail(text: string): boolean {
  const t = String(text || '').toLowerCase()
  return /\b(?:latest|last|most recent|newest)\s+(?:e-?mail|mail|message)\b(?!s)/.test(t) && !/\b(?:e-?mails|mails|messages)\b/.test(t)
}

/** "Thu 8 Oct, 9:14 pm" in IST, or the raw value when it is not a date. */
export function formatEmailDateIST(raw: string | null | undefined): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()}`
}

const BOILERPLATE = [
  /email not displaying correctly\??\s*(?:view it (?:online|in (?:your|a) browser)\.?)?/gi,
  /view (?:this email |it )?in (?:your|a) browser\.?/gi,
  /having trouble viewing this (?:email|message)\??/gi,
  /\b(?:unsubscribe|manage preferences)\b.*$/gi,
]
export function cleanEmailSnippet(raw: string | null | undefined, max = 200): string {
  let s = String(raw || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/‌|​/g, '')
  for (const re of BOILERPLATE) s = s.replace(re, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}
