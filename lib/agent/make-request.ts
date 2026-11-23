// "Make a one-page brief on …", "Create a report on …": a Make deliverable (saved in Make), not a chat answer.
// Shared by the planner and the understand-first dispatcher so neither answers it inline (23 Oct live).
export const MAKE_DELIVERABLE_RE = /^(?:please\s+|can you\s+|could you\s+)?(?:make|create|write|prepare|build|put together|draw up|produce)\s+(?:me\s+)?(?:a|an|the|my)?\s*(?:private\s+)?(?:short\s+|quick\s+|detailed\s+|one[- ]page\s+|1[- ]page\s+|\d{1,2}[- ]?(?:slide|page|day)s?\s+)?(?:research\s+|pitch\s+|budget\s+|travel\s+|trip\s+)?(?:brief|report|one[- ]pager|comparison(?:\s+table)?|summary\s+report|tracker|guide|checklist|deck(?:\s+outline)?|presentation|slides?|slide\s+deck|sheet|spreadsheet|budget|itinerary|proposal|memo)\b/i

export function isMakeDeliverableRequest(text: string): boolean {
  const t = String(text || '').trim()
  return MAKE_DELIVERABLE_RE.test(t) && !/\b(?:e-?mail|message|whatsapp|text|reply)\b/i.test(t)
}

/** Only accept explicit public citation URLs. These are searched, never fetched directly. */
export function sourceBoundReport(text: string): {title: string; urls: string[]} | null {
  if (!isMakeDeliverableRequest(text) || !/^.{0,75}\b(?:report|brief)\b/i.test(text)) return null
  const marker = /(?:^|[.!?;]\s*)(?:please\s+)?use only (?:these|the following) (?:(?:official|public) )?sources\s*:\s*/i.exec(text)
  if (!marker) return null
  const before = text.slice(0, marker.index)
  const title = before.match(/\btitled\s+["“]?([^.!?"”\r\n]{1,120})/i)?.[1].trim() || 'Source-bound research brief'
  const list = text.slice(marker.index + marker[0].length)
    .match(/^https?:\/\/[^\s<>]+(?:\s*(?:,|and)\s+https?:\/\/[^\s<>]+)*/i)?.[0] || ''
  const links = [...list.matchAll(/https?:\/\/[^\s<>]+/gi)].map(match => match[0].replace(/[),.;!?]+$/, ''))
  const urls = links.map(researchSourceUrl)
  return {title,urls:text.length <= 1800 && urls.length <= 5 && urls.every(Boolean) ? [...new Set(urls)] : []}
}

export function researchSourceUrl(link: string): string {
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search
      || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname) || /\.(?:local|internal|test|example|localhost|onion)$/i.test(url.hostname)
      || !/^\/[\w./-]+$/.test(url.pathname) || /\/(?:private|auth|account|invite)(?:\/|$)/i.test(url.pathname)) return ''
    url.hostname = url.hostname.replace(/^www\./i,'')
    url.pathname = url.pathname.replace(/\/$/,'')
    return url.toString()
  } catch { return '' }
}
