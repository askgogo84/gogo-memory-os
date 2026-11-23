// "Make a one-page brief on …", "Create a report on …": a Make deliverable (saved in Make), not a chat answer.
// Shared by the planner and the understand-first dispatcher so neither answers it inline (23 Oct live).
export const MAKE_DELIVERABLE_RE = /^(?:please\s+|can you\s+|could you\s+)?(?:make|create|write|prepare|build|put together|draw up|produce)\s+(?:me\s+)?(?:a|an|the|my)?\s*(?:private\s+)?(?:short\s+|quick\s+|detailed\s+|one[- ]page\s+|1[- ]page\s+|\d{1,2}[- ]?(?:slide|page|day)s?\s+)?(?:research\s+|pitch\s+|budget\s+|travel\s+|trip\s+)?(?:brief|report|one[- ]pager|comparison(?:\s+table)?|summary\s+report|tracker|guide|checklist|deck(?:\s+outline)?|presentation|slides?|slide\s+deck|sheet|spreadsheet|budget|itinerary|proposal|memo)\b/i

export function isMakeDeliverableRequest(text: string): boolean {
  const t = String(text || '').trim()
  return MAKE_DELIVERABLE_RE.test(t) && !/\b(?:e-?mail|message|whatsapp|text|reply)\b/i.test(t)
}

/** Only accept explicit public citation URLs. These are searched, never fetched directly. */
export function sourceBoundReport(text: string): {title: string; explicitTitle: boolean; urls: string[]; reportOnly: boolean} | null {
  text = text.trim()
  const command = MAKE_DELIVERABLE_RE.exec(text)?.[0] || ''
  if (!/\b(?:report|brief)$/i.test(command)) return null
  const marker = /(?:^|[.!?;]\s*)(?:please\s+)?use only (?:these|the following) (?:(?:official|public) )?sources\s*:\s*/i.exec(text)
  if (!marker) return null
  const before = text.slice(0, marker.index)
  const namedTitle = before.match(/\btitled\s+["“]?([^.!?"”\r\n]{1,120})/i)?.[1].trim()
  const subject = before.slice(command.length).match(/^\s+(?:on|about|covering)\s+([^.!?\r\n]{1,100})/i)?.[1].trim()
  const list = text.slice(marker.index + marker[0].length)
  const links = [...list.matchAll(/https?:\/\/[^\s<>,]+/gi)]
  const separators = /^(?:[\s,;*•-]|and\b|\d+[.)])*$/i
  const parsedUrls = links.map((link,i) => {
    const prior = links[i-1]
    const from = prior ? prior.index! + prior[0].length : 0
    return separators.test(list.slice(from,link.index)) ? researchSourceUrl(link[0].replace(/[),.;!?]+$/, '')) : ''
  })
  const reportOnly = !/(?:[.!?;]\s*|\b(?:and|then|also|next)\s+)(?:please\s+)?(?:create|add|set|schedule|remind|send|email|text|call|reply|book|buy|pay|cancel|delete|publish|post|share|submit|upload|update|move|change|find|search|show|list|check|draft)\b/i.test(text.slice(command.length))
  const urls = text.length <= 1800 && parsedUrls.length <= 5 && parsedUrls.every(Boolean) ? [...new Set(parsedUrls)] : []
  const host = urls[0] ? new URL(urls[0]).hostname : ''
  const title = namedTitle || subject || (host ? `Research brief from ${host}` : 'Source-bound research brief')
  return {title,explicitTitle:Boolean(namedTitle),reportOnly,urls}
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
