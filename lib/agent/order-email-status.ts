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

export function formatOrderEmailAnswer(site: CatalogueSite, messages: Array<{ subject?: string; date?: string; snippet?: string }>) {
  if (!messages.length) return null
  const line = (m: any) => {
    const date = formatEmailDateIST(m.date)
    const snippet = cleanEmailSnippet(m.snippet)
    return `*${String(m.subject || 'Order update').trim()}*${date ? `\n${date}` : ''}${snippet ? `\n${snippet}` : ''}`
  }
  const [latest, ...earlier] = messages
  const parts = [`From your ${site.name} emails, the latest order update:`, '', line(latest)]
  if (earlier.length) parts.push('', 'Before that:', ...earlier.slice(0, 2).map(m => `• ${String(m.subject || 'Order update').trim()}${formatEmailDateIST(m.date) ? ` (${formatEmailDateIST(m.date)})` : ''}`))
  return parts.join('\n')
}

/** An answer from Gmail, or null when Gmail is not connected, reading is off, or nothing matched. */
export async function tryOrderStatusFromEmail(actor: AgentActor, site: CatalogueSite, text: string) {
  if (!isOrderStatusQuestion(text)) return null
  const q = orderEmailQuery(site)
  if (!q) return null
  const messages = await searchWorkspaceEmailsByQuery(actor, q, 3).catch(() => null)
  if (!messages) return null
  return formatOrderEmailAnswer(site, messages)
}
