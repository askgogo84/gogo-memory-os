// Stock rules, pure. The numbers come from the outlet's own cancellation history, never a guess.
import type { MenuItem, Order } from './types'

const DAY = 86_400_000
/** IST hour (fractional) of an ISO timestamp. */
export const istHour = (iso: string) => ((Date.parse(iso) / 3_600_000 + 5.5) % 24 + 24) % 24

export type StockFlag = { itemId: string; name: string; count: number; since: string; afterHour: number | null }

/** Items in this order that caused ≥ 2 out-of-stock cancellations in the last `days` days at this outlet,
 *  with the hour after which those cancellations happened (when they all fall after one hour). */
export function stockFlags(order: Order, history: Order[], now: number, days = 2, min = 2): StockFlag[] {
  const since = now - days * DAY
  const flags: StockFlag[] = []
  for (const line of order.items) {
    const hits = history.filter(o => o.id !== order.id && o.outletId === order.outletId && o.state === 'cancelled' && o.cancelReason === 'out_of_stock' && Date.parse(o.createdAt) >= since && (o.outOfStockItemId ? o.outOfStockItemId === line.itemId : o.items.some(l => l.itemId === line.itemId)))
    if (hits.length < min) continue
    const hours = hits.map(h => istHour(h.createdAt))
    const earliest = Math.min(...hours)
    flags.push({ itemId: line.itemId, name: line.name, count: hits.length, since: new Date(since).toISOString(), afterHour: earliest >= 11 ? Math.floor(earliest) : null })
  }
  return flags
}

export type CutoffProposal = { items: { itemId: string; name: string; count: number }[]; total: number; days: number; afterHour: number }

/** ≥ `min` out-of-stock cancellations in `days` days on breakfast items after 11:30 → propose turning them off at 11:30. Pure. */
export function cutoffProposal(outletId: string, history: Order[], items: MenuItem[], now: number, days = 7, min = 3): CutoffProposal | null {
  const since = now - days * DAY
  const breakfast = new Set(items.filter(i => i.outletId === outletId && i.category === 'breakfast').map(i => i.id))
  const counts = new Map<string, { name: string; count: number }>()
  for (const o of history) {
    if (o.outletId !== outletId || o.state !== 'cancelled' || o.cancelReason !== 'out_of_stock' || Date.parse(o.createdAt) < since || istHour(o.createdAt) < 11.5) continue
    for (const l of o.items) if (breakfast.has(l.itemId) && (!o.outOfStockItemId || o.outOfStockItemId === l.itemId)) counts.set(l.itemId, { name: l.name, count: (counts.get(l.itemId)?.count || 0) + 1 })
  }
  const list = [...counts.entries()].map(([itemId, v]) => ({ itemId, ...v })).sort((a, b) => b.count - a.count)
  const total = list.reduce((s, x) => s + x.count, 0)
  return total >= min ? { items: list.slice(0, 5), total, days, afterHour: 11.5 } : null
}

export type DayStats = { orders: number; revenuePaise: number; accepted: number; rejected: number; cancelled: number; outOfStock: number; outOfStockItems: { name: string; count: number }[] }
/** Today-so-far (or any window) for one outlet. Pure. */
export function dayStats(outletId: string | null, orders: Order[], fromISO: string, toISO: string): DayStats {
  const inWin = orders.filter(o => (outletId === null || o.outletId === outletId) && o.createdAt >= fromISO && o.createdAt < toISO)
  const oos = inWin.filter(o => o.state === 'cancelled' && o.cancelReason === 'out_of_stock')
  const counts = new Map<string, number>()
  for (const o of oos) for (const l of o.items) if (!o.outOfStockItemId || o.outOfStockItemId === l.itemId) counts.set(l.name, (counts.get(l.name) || 0) + 1)
  return {
    orders: inWin.length,
    revenuePaise: inWin.filter(o => o.state !== 'cancelled' && o.state !== 'rejected').reduce((s, o) => s + o.amountPaise, 0),
    accepted: inWin.filter(o => o.state === 'accepted' || o.state === 'picked_up' || o.state === 'delivered').length,
    rejected: inWin.filter(o => o.state === 'rejected').length,
    cancelled: inWin.filter(o => o.state === 'cancelled').length,
    outOfStock: oos.length,
    outOfStockItems: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
}
