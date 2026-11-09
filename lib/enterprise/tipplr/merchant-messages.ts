// What the merchant reads, screen 1 of the approved mock (7 Nov). Pure. Under 400 characters, three buttons at most
// (Meta's limit), verbs first, no emoji beyond the header tag, rupee with Indian grouping, 12-hour times.
import type { Order } from './types'
import { hhmm, inr } from './types'
import type { StockFlag } from './stock-rules'
import type { ActionRecord } from '@/lib/agent/action-record'
import { receiptLine } from '@/lib/agent/action-record'

export type Button = { id: string; title: string }
export type MerchantMessage = { text: string; buttons: Button[] }

const SOURCE = { flipkart: 'Flipkart', ondc: 'ONDC' } as const
const itemsLine = (o: Order) => o.items.map(l => `${l.qty} × ${l.name}`).join(', ')
const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`

/** New order, with the stock check when the outlet's own history says an item has been running out. */
export function newOrderMessage(o: Order, flags: StockFlag[], tz = 'Asia/Kolkata'): MerchantMessage {
  const head = flags.length ? 'Check stock' : `New order · ${SOURCE[o.source]}`
  const line1 = `*#${o.id}* · ${itemsLine(o)} · *${inr(o.amountPaise)}* · pickup by ${hhmm(o.pickupBy, tz)}`
  const line2 = `${o.customerFirstName} · ${o.area} · ${o.prepaid ? 'prepaid' : 'cash on delivery'}`
  if (!flags.length) return { text: `${head}\n${line1}\n${line2}`, buttons: [{ id: `accept:${o.id}:15`, title: 'Accept · 15 min' }, { id: `accept:${o.id}:25`, title: 'Accept · 25 min' }, { id: `reject:${o.id}:no_response`, title: "Can't make it" }] }
  const f = flags[0]
  const when = f.afterHour !== null ? ` after ${hourWord(f.afterHour)}` : ''
  const ask = `${f.name} was the reason for *${f.count} cancellation${f.count === 1 ? '' : 's'}* in the last 2 days${when}. Still available now?`
  return { text: `${head}\n${line1}\n${line2}\n${ask}`, buttons: [{ id: `accept:${o.id}:15`, title: 'Yes, accept · 15 min' }, { id: `reject:${o.id}:out_of_stock`, title: 'Out of stock, reject' }] }
}

/** After an accept: the receipt comes from the action record, so "Done" means Tipplr's read-back said accepted. */
export function acceptReceipt(rec: ActionRecord, o: Order): string {
  const what = `#${o.id} accepted, ${o.prepMinutes ?? rec.evidence.find(e => e.ids?.prepMinutes)?.ids?.prepMinutes ?? '15'} minutes`
  const line = receiptLine(rec, what)
  if (rec.state !== 'verified_success') return line
  return `${line} Tipplr confirmed it (order state *${o.state}*). ${o.source === 'flipkart' ? 'Rider is assigned by Flipkart' : 'Pickup is arranged by the buyer app'}; I'll tell you when they're 5 minutes out.`
}

export function rejectReceipt(rec: ActionRecord, o: Order, reason: 'out_of_stock' | 'no_response'): string {
  const what = `#${o.id} rejected${reason === 'out_of_stock' ? ' as out of stock' : ''}`
  return receiptLine(rec, what)
}

/** The one follow-up after a stock reject. */
export function markOutOfStockOffer(o: Order, itemName: string, untilHour = 17): MerchantMessage {
  return { text: `Want me to mark *${itemName}* out of stock on Tipplr until ${hourWord(untilHour)} so this doesn't repeat?`, buttons: [{ id: `oos:${o.outletId}:${encodeURIComponent(itemName)}:${untilHour}`, title: `Yes, until ${hourWord(untilHour)}` }, { id: 'noop', title: 'Leave it' }] }
}

export function availabilityReceipt(rec: ActionRecord, itemName: string, available: boolean, untilHour?: number): string {
  const what = available ? `${itemName} back on` : `${itemName} marked out of stock${untilHour ? ` until ${hourWord(untilHour)}` : ''}`
  const line = receiptLine(rec, what)
  return rec.state === 'verified_success' ? `${line} Checked back: Tipplr shows it ${available ? 'available' : 'unavailable'}.` : line
}

/** POS-integrated outlets never get an availability write from the pilot. */
export const POS_REFUSAL = "This outlet's menu is managed by its POS (Petpooja/UrbanPiper), so I don't change availability here. Mark it out of stock in the POS and Tipplr will follow."

/** 400-character ceiling for order messages. Pure. */
export const withinLimit = (m: MerchantMessage) => m.text.length <= 400 && m.buttons.length <= 3 && m.buttons.every(b => b.title.length <= 20)
