// Older saved task summaries carry raw ISO times ("2026-11-20T10:20:00 → 2026-11-20T17:40:00"). Show them the way new
// replies do ("10:20 am → 5:40 pm"), and any other lone ISO time as "20 Nov, 10:20 am".
import { formatFlightTiming } from '@/lib/agent/flight-timing'

const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?`
const NAIVE = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?![\dZ+:.-])`
const PAIR = new RegExp(`(${NAIVE})\\s*→\\s*(${NAIVE})`, 'g')
const SINGLE = new RegExp(`\\b(${ISO})`, 'g')
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function lone(iso: string) {
  // A time with a zone is an instant: show it in India time. A naive time is already local to the place it names.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) && Number.isFinite(Date.parse(iso))) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/\s?([ap])m$/i, ' $1m').replace(/AM|PM/, x => x.toLowerCase())
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  const h = Number(m[4])
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || m[2]}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'am' : 'pm'}`
}

export function readableRunSummary(text: unknown): string {
  const s = String(text ?? '')
  if (!s) return ''
  return s.replace(PAIR, (_, a, b) => formatFlightTiming(a, b)).replace(SINGLE, (_, a) => lone(a))
}
