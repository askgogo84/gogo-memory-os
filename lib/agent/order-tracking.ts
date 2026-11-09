// Order tracking from the shop's own emails (6 Nov, owner): "read all important mails… including tracking of orders
// I have placed… in case it's missed it should alert". Read-only Gmail metadata from shop senders. Each order's
// latest status and promised date come from its emails; Gogo alerts once when a shop reports a problem (delay,
// failed attempt, cancelled) or when the promised day has passed with no delivery email. Quick commerce and food
// (delivered within the hour) are left out. Nothing is changed in Gmail or at the shop.
import type { AgentActor } from './actor'

export type OrderStatus = 'placed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'delayed' | 'attempt_failed' | 'cancelled' | 'returned' | 'refunded'
export type OrderMail = { id?: string; threadId?: string; from: string; subject: string; snippet?: string; date?: string }
export type OrderEvent = { shop: string; key: string; label: string; orderId: string | null; status: OrderStatus; expected: string | null; at: string }
export type TrackedOrder = { shop: string; key: string; label: string; orderId: string | null; status: OrderStatus; expected: string | null; updated: string; problem: boolean }

// Shops whose orders take days and send dispatch/delivery emails. Food and 10-minute delivery are excluded.
const SHOPS: [string, RegExp][] = [
  ['Amazon', /@(?:[a-z0-9-]+\.)*amazon\.in\b/i], ['Flipkart', /@(?:[a-z0-9-]+\.)*flipkart\.com\b/i], ['Myntra', /@(?:[a-z0-9-]+\.)*myntra\.com\b/i],
  ['AJIO', /@(?:[a-z0-9-]+\.)*ajio\.com\b/i], ['Nykaa', /@(?:[a-z0-9-]+\.)*nykaa\.com\b/i], ['Meesho', /@(?:[a-z0-9-]+\.)*meesho\.com\b/i],
  ['Tata CLiQ', /@(?:[a-z0-9-]+\.)*tatacliq\.com\b/i], ['Croma', /@(?:[a-z0-9-]+\.)*croma\.com\b/i], ['Reliance Digital', /@(?:[a-z0-9-]+\.)*reliancedigital\.in\b/i],
  ['Lenskart', /@(?:[a-z0-9-]+\.)*lenskart\.com\b/i], ['Decathlon', /@(?:[a-z0-9-]+\.)*decathlon\.in\b/i], ['FirstCry', /@(?:[a-z0-9-]+\.)*firstcry\.com\b/i],
  ['JioMart', /@(?:[a-z0-9-]+\.)*jiomart\.com\b/i], ['BigBasket', /@(?:[a-z0-9-]+\.)*bigbasket\.com\b/i],
]
export const ORDER_GMAIL_QUERY = `from:(amazon.in OR flipkart.com OR myntra.com OR ajio.com OR nykaa.com OR meesho.com OR tatacliq.com OR croma.com OR reliancedigital.in OR lenskart.com OR decathlon.in OR firstcry.com OR jiomart.com OR bigbasket.com) newer_than:21d -category:promotions (order OR shipped OR dispatched OR delivered OR delivery OR arriving OR "out for delivery" OR delayed OR cancelled OR refund)`

// 6 Nov (owner, Dots screenshot): a small brand's order ("Drip N' Dip", shipped by Shiprocket) must be tracked too.
// Any sender counts when the email is clearly about an order; couriers and store platforms are recognised by name.
const COURIERS: [string, RegExp][] = [
  ['Shiprocket', /shiprocket/i], ['Delhivery', /delhivery/i], ['Blue Dart', /bluedart/i], ['Ekart', /ekart/i], ['Xpressbees', /xpressbees/i],
  ['Ecom Express', /ecomexpress/i], ['DTDC', /dtdc/i], ['India Post', /indiapost/i], ['Shadowfax', /shadowfax/i], ['Smartr', /smartr/i],
  ['NimbusPost', /nimbuspost/i], ['Pickrr', /pickrr/i], ['ClickPost', /clickpost/i], ['Shopify', /shopify/i],
]
// Food and 10-minute delivery arrive within the hour; tracking them by email only adds noise.
const QUICK = /@(?:[a-z0-9-]+\.)*(?:swiggy\.in|zomato\.com|blinkit\.com|zeptonow\.com|zepto\.co|bbnow\.in|dunzo\.in|eatclub\.in|box8\.in|dominos\.co\.in|magicpin\.in|uber\.com|olacabs\.com|rapido\.bike)\b/i
export const ORDER_GMAIL_QUERY_ANY = `newer_than:21d -category:promotions -category:social -from:(swiggy.in OR zomato.com OR blinkit.com OR zeptonow.com OR bbnow.in OR dunzo.in OR uber.com OR olacabs.com) subject:(order OR shipped OR dispatched OR delivered OR "out for delivery" OR shipment OR arriving OR parcel OR package)`

const displayName = (from: string) => from.replace(/<[^>]*>/, '').replace(/["']/g, '').replace(/\b(?:via|through)\s+\w+.*$/i, '').replace(/\b(?:team|orders?|support|no-?reply|notifications?|updates?|care)\b/gi, '').replace(/\s{2,}/g, ' ').trim()

/** The shop's name: a known marketplace, the brand named in the email, or the sender's name. Null for food/quick commerce. Pure. */
export function shopOf(from: string, subject = '', snippet = '') {
  if (QUICK.test(from)) return null
  const known = SHOPS.find(([, re]) => re.test(from))?.[0]
  if (known) return known
  const text = `${subject} ${snippet}`.replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  // "order from Drip N' Dip" or (Shiprocket's live subjects, 6 Nov) "your Drip N' Dip order is out for delivery".
  const brand = (text.match(/\b(?:order|purchase|package|shipment)\s+from\s+([A-Z][\w'&.-]*(?:\s+[A-Z0-9][\w'&.-]*){0,3})/)?.[1]
    || text.match(/\byour\s+([A-Z0-9][\w'&.-]*(?:\s+[A-Z0-9][\w'&.-]*){0,3})\s+(?:order|package|shipment|parcel)\b/)?.[1])?.trim()
  if (brand && !/^(?:Amazon|Flipkart)$/i.test(brand)) return brand.slice(0, 40)
  const courier = COURIERS.find(([, re]) => re.test(from))?.[0]
  const name = displayName(from)
  if (name && name.length >= 2 && !/^(?:[a-z0-9._-]+@|no ?reply$)/i.test(name) && !COURIERS.some(([, re]) => re.test(name))) return name.slice(0, 40)
  return courier || null
}
const ORDER_WORD = /\b(?:order|shipment|package|parcel|awb|tracking|consignment)\b/i

/** Status from the subject first (shops put it there), then the preview. Pure. */
export function orderStatus(subject: string, snippet = ''): OrderStatus | null {
  const s = subject.toLowerCase(), all = `${s} ${snippet.toLowerCase()}`
  if (/\b(?:offer|sale|deal|% off|coupon|cashback offer|recommended|you might like|review your|rate your|how was)\b/.test(s)) return null
  if (/\brefund(?:ed| issued| initiated| processed)?\b/.test(s)) return 'refunded'
  if (/\b(?:cancell?ed|cancellation)\b/.test(s)) return 'cancelled'
  if (/\breturn(?:ed| picked| received| request)\b/.test(s)) return 'returned'
  if (/\b(?:delivery attempt(?:ed)? (?:failed|unsuccessful)|could(?: not|n't) (?:be )?deliver|undeliver(?:ed|able)|delivery failed|missed (?:your )?delivery)\b/.test(all)) return 'attempt_failed'
  if (/\b(?:delayed|delay in|running late|new delivery date|revised delivery|rescheduled)\b/.test(all)) return 'delayed'
  if (/\bdelivered\b/.test(s)) return 'delivered'
  if (/\bout for delivery\b/.test(s)) return 'out_for_delivery'
  if (/\b(?:shipped|dispatched|on (?:its|the) way|in transit|arriving|reached your city|in your city|arrived (?:at|in))\b/.test(s)) return 'shipped'
  if (/\b(?:order (?:placed|confirm(?:ed|ation)|received)|thank you for (?:your )?order|your order (?:of|for|has been placed|is confirmed)|ordered:|order (?:has been |is )?packed)\b/.test(s)) return 'placed'
  return null
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10)

/** "Arriving tomorrow", "Arriving Friday", "delivery by 8 Nov", "Expected by Sat, 08 Nov 2026" → YYYY-MM-DD (IST), relative to the email's date. Pure. */
export function expectedDay(text: string, sentAt: string): string | null {
  const t = text.toLowerCase(), sent = Date.parse(sentAt)
  if (!Number.isFinite(sent)) return null
  if (!/\b(?:arriv\w*|deliver\w*|expected|estimated|by|eta)\b/.test(t)) return null
  if (/\b(?:arriving|delivery|delivered|expected)\s+today\b/.test(t)) return istDay(sent)
  if (/\b(?:arriving|delivery|expected|by)\s+tomorrow\b/.test(t)) return istDay(sent + 86_400_000)
  const dm = t.match(/\b(?:arriv\w*|deliver\w*|expected|estimated|eta)\b[^.]{0,40}?\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:,?\s+(\d{4}))?/)
    || t.match(/\bby\s+(?:[a-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:,?\s+(\d{4}))?/)
  const md = !dm ? t.match(/\b(?:arriv\w*|deliver\w*|expected|estimated|eta)\b[^.]{0,40}?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/) : null
  if (md) {
    const base = new Date(sent + 330 * 60_000)
    let year = md[3] ? Number(md[3]) : base.getUTCFullYear()
    const month = MONTHS[md[1]], day = Number(md[2])
    if (!md[3] && month < base.getUTCMonth() - 6) year += 1
    const d = new Date(Date.UTC(year, month, day))
    return d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null
  }
  if (dm) {
    const base = new Date(sent + 330 * 60_000)
    let year = dm[3] ? Number(dm[3]) : base.getUTCFullYear()
    const month = MONTHS[dm[2]], day = Number(dm[1])
    if (!dm[3] && (month < base.getUTCMonth() - 6)) year += 1
    const d = new Date(Date.UTC(year, month, day))
    return d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null
  }
  const wd = t.match(/\b(?:arriving|delivery|expected|by)\s+(?:on\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (wd) {
    const base = new Date(sent + 330 * 60_000)
    const ahead = (DAYS.indexOf(wd[1]) - base.getUTCDay() + 7) % 7 || 7
    return istDay(sent + ahead * 86_400_000)
  }
  return null
}

/** One email → one order event, or null for offers and non-order mail. Pure. */
export function orderEvent(m: OrderMail): OrderEvent | null {
  const shop = shopOf(m.from, m.subject, m.snippet)
  const status = shop ? orderStatus(m.subject, m.snippet) : null
  if (!shop || !status) return null
  // An unknown sender's "cancelled", "delivered" or "refund" (a flight, a statement) counts only when it names an order.
  const marketplace = SHOPS.some(([, re]) => re.test(m.from)), courier = COURIERS.some(([, re]) => re.test(m.from))
  if (!marketplace && !courier && !ORDER_WORD.test(`${m.subject} ${m.snippet || ''}`)) return null
  const text = `${m.subject} ${m.snippet || ''}`
  const orderId = text.match(/\b(\d{3}-\d{7}-\d{7})\b/)?.[1] // Amazon
    || text.match(/\b(OD\d{12,20})\b/)?.[1] // Flipkart
    || text.match(/\border\s*(?:id|no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,24})\b/i)?.[1] || null
  // The item name when the shop quotes it ('Delivered: "boAt Airdopes 141"'); otherwise the shop and order number.
  // Subjects such as "Delivery attempt failed for your order" are status, not an item name.
  const quoted = m.subject.match(/["“']([^"”']{3,80})["”']/)?.[1]?.trim()
  const label = (quoted || `${shop} order${orderId ? ` …${orderId.slice(-6)}` : ''}`).slice(0, 70)
  // One order per order number; else per quoted item; else per email thread (never all unnamed orders as one).
  const key = `${shop}:${orderId || (quoted ? quoted.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40) : m.threadId || m.id || m.subject)}`
  return { shop, key, label, orderId, status, expected: expectedDay(text, m.date || ''), at: new Date(Date.parse(m.date || '') || 0).toISOString() }
}

const DONE: OrderStatus[] = ['delivered', 'cancelled', 'returned', 'refunded']

/** Latest status and promised day per order. Pure. */
export function trackOrders(mails: OrderMail[]): TrackedOrder[] {
  const byKey = new Map<string, OrderEvent[]>()
  const events = mails.map(orderEvent).filter((e): e is OrderEvent => !!e)
  // A shop's "shipped" email often lacks the order number its "out for delivery" email has. When the shop has just
  // one numbered order, an unnumbered, unnamed email from it belongs to that order.
  for (const e of events) {
    if (e.orderId || !e.label.startsWith(`${e.shop} order`)) continue
    const ids = [...new Set(events.filter(x => x.shop === e.shop && x.orderId).map(x => x.key))]
    if (ids.length === 1) { e.key = ids[0]; continue }
    if (!ids.length && events.filter(x => x.shop === e.shop && !x.orderId && x.label.startsWith(`${x.shop} order`)).length > 1) e.key = `${e.shop}:unnumbered`
  }
  for (const e of events) byKey.set(e.key, [...(byKey.get(e.key) || []), e])
  return [...byKey.values()].map(events => {
    events.sort((a, b) => a.at.localeCompare(b.at))
    // A later "arriving early" or "reached your city" email must not move an order back from "out for delivery".
    const RANK: Partial<Record<OrderStatus, number>> = { placed: 1, shipped: 2, out_for_delivery: 3, delivered: 4 }
    let last = events[events.length - 1]
    const furthest = events.reduce((a, e) => (RANK[e.status] || 0) > (RANK[a.status] || 0) ? e : a, events[0])
    if (RANK[last.status] && (RANK[furthest.status] || 0) > (RANK[last.status] || 0)) last = { ...last, status: furthest.status }
    const expected = [...events].reverse().find(e => e.expected)?.expected || null
    const label = events.find(e => !e.label.startsWith(`${e.shop} order`))?.label || last.label
    return { shop: last.shop, key: last.key, label, orderId: last.orderId, status: last.status, expected, updated: last.at, problem: last.status === 'delayed' || last.status === 'attempt_failed' }
  }).sort((a, b) => b.updated.localeCompare(a.updated))
}

/** A delivery is missed when the promised IST day is over (checked from 10 am the next day) with no delivery email. Pure. */
export function isMissed(o: TrackedOrder, now = Date.now()) {
  if (!o.expected || DONE.includes(o.status)) return false
  return now >= Date.parse(`${o.expected}T00:00:00+05:30`) + 34 * 3_600_000
}

const STATUS_TEXT: Record<OrderStatus, string> = {
  placed: 'Ordered', shipped: 'Shipped', out_for_delivery: 'Out for delivery', delivered: 'Delivered', delayed: 'Delayed',
  attempt_failed: 'Delivery attempt failed', cancelled: 'Cancelled', returned: 'Returned', refunded: 'Refunded',
}
const dayText = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

// "Your *Drip N' Dip order*" when the shop named no item; "*boAt Airdopes 141* (Amazon)" when it did.
const whoOf = (o: TrackedOrder) => o.label.startsWith(`${o.shop} order`) ? `Your *${o.shop} order*` : `*${o.label}* (${o.shop})`

/** Alerts not sent before: a problem the shop reported, or a missed promised day. Pure. */
export function orderAlerts(orders: TrackedOrder[], alreadySent: string[], now = Date.now()) {
  const sent = new Set(alreadySent)
  return orders.flatMap(o => {
    // Dots-style heads-up (6 Nov, owner): "out for delivery today" is worth one message too.
    const outToday = o.status === 'out_for_delivery' && istDay(Date.parse(o.updated)) === istDay(now)
    const reason = o.problem ? o.status : isMissed(o, now) ? 'missed' : outToday ? 'out_today' : null
    if (!reason) return []
    const id = `${o.key}|${reason}|${o.expected || ''}`
    if (sent.has(id)) return []
    const early = o.expected && o.expected > istDay(now) ? `, earlier than the ${dayText(o.expected)} it promised` : ''
    const line = reason === 'out_today' ? `${whoOf(o)} is out for delivery today${early}.`
      : reason === 'missed'
      ? `${whoOf(o)} was due ${dayText(o.expected!)}, and I haven't seen a delivery email. Last update: ${STATUS_TEXT[o.status]}.`
      : `${whoOf(o)}: ${STATUS_TEXT[o.status]}${o.expected ? `, now expected ${dayText(o.expected)}` : ''}.`
    return [{ id, line }]
  })
}

/** "Track my orders" answer. Pure. */
export function formatOrders(orders: TrackedOrder[], now = Date.now()) {
  const open = orders.filter(o => !DONE.includes(o.status))
  const recent = orders.filter(o => o.status === 'delivered' && now - Date.parse(o.updated) < 3 * 86_400_000)
  if (!open.length && !recent.length) return 'No orders on the way in your emails from the last 3 weeks. Food and 10-minute deliveries are not tracked.'
  const row = (o: TrackedOrder) => `• *${o.label}* · ${o.shop}\n  ${isMissed(o, now) ? `⚠️ Was due ${dayText(o.expected!)}, no delivery email yet` : `${STATUS_TEXT[o.status]}${o.expected && o.status !== 'delivered' ? ` · expected ${dayText(o.expected)}` : ''}`}`
  const parts = []
  if (open.length) parts.push(`📦 *On the way (${open.length})*`, ...open.slice(0, 8).map(row))
  if (recent.length) parts.push('', `✅ *Delivered recently*`, ...recent.slice(0, 4).map(o => `• ${o.label} · ${o.shop}`))
  parts.push('', "From the shops' emails in your Gmail. I'll message you if a shop reports a delay or a delivery day passes without a delivery email.")
  return parts.join('\n')
}

export const ORDER_LIST_RE = /^\s*(?:(?:please\s+)?(?:track|show|list|check)\s+(?:all\s+)?(?:my\s+)?(?:orders?|deliveries|parcels|packages|shipments)|(?:where|what)(?:'s|\s+is|\s+are)\s+my\s+(?:orders?|deliveries|parcels|packages)|my\s+(?:orders?|deliveries|parcels|packages)|any\s+(?:pending\s+|upcoming\s+)?(?:deliveries|orders?|parcels|packages)(?:\s+(?:on\s+the\s+way|coming|due|pending|today))?|(?:what(?:'s|\s+is)\s+)?(?:arriving|coming)\s+today)\s*\??\s*$/i

export async function readOrders(actor: Pick<AgentActor, 'legacyTelegramId'> & Partial<AgentActor>) {
  const { searchWorkspaceEmailsByQuery } = await import('./google-workspace-read')
  // Ten newest shop emails per page; two pages are enough for three weeks of normal shopping.
  const [shops, any] = await Promise.all([
    searchWorkspaceEmailsByQuery(actor as AgentActor, ORDER_GMAIL_QUERY, 10),
    searchWorkspaceEmailsByQuery(actor as AgentActor, ORDER_GMAIL_QUERY_ANY, 10).catch(() => []),
  ])
  const seen = new Set<string>()
  const mails = [...shops, ...any].filter((m: any) => { const id = String(m?.id || ''); if (!id || seen.has(id)) return false; seen.add(id); return true })
  return trackOrders(mails as OrderMail[])
}

export async function tryOrderList(actor: AgentActor, text: string): Promise<string | null> {
  if (!ORDER_LIST_RE.test(String(text || ''))) return null
  try {
    const orders = await readOrders(actor)
    console.log('ORDER_TRACKING:', JSON.stringify({ orders: orders.length, open: orders.filter(o => !DONE.includes(o.status)).length }))
    return formatOrders(orders)
  } catch (err: any) {
    const code = String(err?.message || err)
    if (/workspace_not_connected|workspace_reconnect_required|workspace_scope_required/.test(code)) return 'Connect Gmail in Connections and I can track your orders from the shop emails.'
    if (code.includes('workspace_email_reading_disabled')) return 'Gmail is connected, but email reading is turned off in your privacy setting, so I did not read your mail.'
    return "I couldn't read your shop emails just now. Try again in a minute."
  }
}
