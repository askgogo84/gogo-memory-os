// "Where is my Amazon order?" answered from the shop's own emails in the person's Gmail. 15 Oct live: amazon.in sent
// Gogo's cloud browser "503 - Service Unavailable", while Wajo answered from inside Amazon. Order, dispatch and
// delivery emails carry the same facts, need no sign-in, and come back in seconds.
import type { AgentActor } from './actor'
import { searchWorkspaceEmailsByQuery } from './google-workspace-read'
import { cleanEmailSnippet, formatEmailDateIST } from './email-format'
import type { CatalogueSite } from '@/lib/dashboard/connection-catalogue'

// Senders that send order and delivery updates for each shop.
const ORDER_SENDERS: Record<string, string[]> = {
  amazon: ['amazon.in'],
  flipkart: ['flipkart.com', 'nct.flipkart.com'],
  myntra: ['myntra.com'],
  ajio: ['ajio.com'],
  nykaa: ['nykaa.com'],
  meesho: ['meesho.com'],
  tatacliq: ['tatacliq.com'],
  croma: ['croma.com'],
  reliancedigital: ['reliancedigital.in'],
  lenskart: ['lenskart.com'],
  decathlon: ['decathlon.in'],
  firstcry: ['firstcry.com'],
  bigbasket: ['bigbasket.com'],
  jiomart: ['jiomart.com'],
  blinkit: ['blinkit.com'],
  zomato: ['zomato.com'],
  swiggy: ['swiggy.in'],
  instamart: ['swiggy.in'],
}

/** Only questions about orders and deliveries are answered from email. */
export function isOrderStatusQuestion(text: string) {
  return /\b(?:orders?|order history|deliver(?:y|ies|ed)?|shipments?|shipped|dispatched|parcel|package|track(?:ing)?|arriv(?:e|ing|al))\b/i.test(String(text || ''))
}

export function orderEmailQuery(site: CatalogueSite) {
  const senders = ORDER_SENDERS[site.id]
  if (!senders) return null
  return `from:(${senders.join(' OR ')}) newer_than:45d -category:promotions (order OR ordered OR shipped OR dispatched OR delivered OR delivery OR "out for delivery" OR arriving)`
}

export function orderUpdatesOnly<T extends { subject?: string }>(messages: T[]) {
  return messages.filter(m => /\b(?:order(?:ed)?|deliver(?:y|ed)|shipped|dispatched|out for delivery|arriving|refund|return(?:ed)?|payment)\b/i.test(String(m.subject || '')))
}

/** "last 3 orders" → 3, "my recent orders" → 3, "where is my order" → 1. Capped at 5. */
export function requestedOrderCount(text: string) {
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 }
  const m = String(text || '').toLowerCase().match(/\b(?:last|recent|past|previous)\s+(\d+|two|three|four|five)\b/)
  if (m) return Math.max(1, Math.min(5, Number(m[1]) || words[m[1]] || 1))
  return /\borders\b/i.test(String(text || '')) ? 3 : 1
}

export function formatOrderEmailAnswer(site: CatalogueSite, messages: Array<{ subject?: string; date?: string; snippet?: string }>, count = 1) {
  if (!messages.length) return null
  const detail = (m: any) => {
    const subject = String(m.subject || '').trim()
    let snippet = cleanEmailSnippet(m.snippet, 400)
    // Swiggy's preview runs restaurant, address and name together ("ORDER JOURNEY Priyadarshini Grand 315, Siddhaiah…
    // Goverdhan 1475"); keep the restaurant and the delivery time only.
    const swiggyPlace = snippet.match(/ORDER JOURNEY\s+(.+?)\s+\d/)?.[1]
    if (swiggyPlace) {
      const mins = snippet.match(/Delivery in (\d+) mins/i)?.[1]
      return `From ${swiggyPlace.trim()}${mins ? ` · delivered in ${mins} mins` : ''}`
    }
    if (snippet.length > 120) snippet = `${snippet.slice(0, 119).trimEnd()}…`
    // Shop emails often repeat the subject as the preview text; show it once.
    if (subject && snippet.replace(/["'…]/g, '').toLowerCase().startsWith(subject.replace(/["'…]/g, '').toLowerCase().slice(0, 30))) return ''
    return snippet
  }
  const line = (m: any) => {
    const date = formatEmailDateIST(m.date)
    const more = detail(m)
    return `*${String(m.subject || 'Order update').trim()}*${date ? `\n${date}` : ''}${more ? `\n${more}` : ''}`
  }
  // 16 Oct live: "Show my last 3 Swiggy orders" came back as "the latest order update" with bare subjects below it.
  if (count > 1) {
    const shown = messages.slice(0, count)
    const head = shown.length < count
      ? `I found ${shown.length} ${site.name} order${shown.length === 1 ? '' : 's'} in your emails:`
      : `Your last ${shown.length} ${site.name} orders, from your ${site.name} emails:`
    return [head, '', ...shown.map((m, i) => `${i + 1}. ${line(m)}`).join('\n\n').split('\n')].join('\n')
  }
  const [latest, ...earlier] = messages
  const parts = [`From your ${site.name} emails, the latest order update:`, '', line(latest)]
  if (earlier.length) parts.push('', 'Before that:', ...earlier.slice(0, 2).map(m => {
    const date = formatEmailDateIST(m.date), more = detail(m)
    return `• ${String(m.subject || 'Order update').trim()}${date ? ` (${date})` : ''}${more ? ` · ${more}` : ''}`
  }))
  return parts.join('\n')
}

/** An answer from Gmail, or null when Gmail is not connected, reading is off, or nothing matched. */
export async function tryOrderStatusFromEmail(actor: AgentActor, site: CatalogueSite, text: string) {
  if (!isOrderStatusQuestion(text)) return null
  const q = orderEmailQuery(site)
  if (!q) return null
  const count = requestedOrderCount(text)
  const found = await searchWorkspaceEmailsByQuery(actor, q, Math.max(8, count * 3)).catch(() => null)
  if (!found) return null
  // Shops also send offers that mention "order" in the body (Swiggy's card offers); keep order emails by subject.
  return formatOrderEmailAnswer(site, orderUpdatesOnly(found).slice(0, Math.max(3, count)), count)
}
