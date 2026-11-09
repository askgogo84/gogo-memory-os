// "Build me one page I can check every morning" (v2 mock scene "Page from a sentence"): a Space from chat. v1 keeps it
// honest: the request picks a template (My Day or Trip Board), the page is created once, named as asked, and the
// reply links it. No sources are invented; the page reads only what Spaces already read. Flag-gated like Spaces.
import type { SpaceTemplate } from './schema'

export type PageAsk = { template: Exclude<SpaceTemplate, 'tipplr_exceptions'>; title: string | null }

/** Pure: is this a request for a living page, and which one. Null when it is not. */
export function parsePageAsk(text: string): PageAsk | null {
  const t = String(text || '').trim()
  if (!/\b(?:build|make|create|set up|give)\s+(?:me\s+)?(?:one|a|an)\s+(?:page|dashboard|board|space)\b/i.test(t) && !/\b(?:page|dashboard)\s+(?:i|that i)\s+can\s+check\b/i.test(t)) return null
  if (/\b(?:send|email|pay|book|order|buy)\b/i.test(t) && !/\bpage\b/i.test(t)) return null
  const template: PageAsk['template'] = /\b(?:trip|travel|flight|goa|holiday|vacation|journey)\b/i.test(t) ? 'trip_board' : 'my_day'
  const named = t.match(/\b(?:call(?:ed)?|name(?:d)?|titled?)\s+(?:it\s+)?["“']?([A-Za-z0-9][A-Za-z0-9 &'’-]{1,40}?)["”']?(?:[.!,]|$)/i)
  return { template, title: named ? named[1].trim() : null }
}

/** The reply after creating or finding the page. Pure. */
export function pageReply(p: { created: boolean; title: string; slug: string; refreshMinutes: number }): string {
  const link = `https://app.askgogo.in/dashboard/spaces/${p.slug}`
  return p.created
    ? `Here's *${p.title}*. It refreshes every ${p.refreshMinutes} min from what you've already connected, and it's under Make → Pages.\n${link}\n\nNothing on it sends, books or pays. Tell me what to add or remove.`
    : `You already have *${p.title}*. It refreshes every ${p.refreshMinutes} min and lives under Make → Pages.\n${link}\n\nSay what you'd change and I'll edit it.`
}
