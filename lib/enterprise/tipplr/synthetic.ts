// Seeded synthetic Tipplr: 48 outlets (Cunningham Road (Testing) first), menus with breakfast items, 30 days of
// orders whose out-of-stock cancellations cluster on breakfast items after 11:30. The seed is a constant, so the
// numbers in the tests, the simulator and the WhatsApp digest are the same numbers. In-memory; nothing leaves it.
import type { CancelReason, ItemCategory, MenuItem, Order, OrderLine, Outlet, TipplrAdapter } from './types'
import { paise } from './types'

/** Deterministic PRNG (mulberry32). Pure. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]

const AREAS = ['Indiranagar', 'Koramangala', 'HSR', 'JP Nagar', 'Jayanagar', 'Rajajinagar', 'Malleshwaram', 'Whitefield', 'Marathahalli', 'BTM', 'Basavanagudi', 'Hebbal']
const OUTLET_NAMES = ["Nithin's Kitchen", 'Dosa Camp', 'Café Divya', 'Udupi Grand', 'Rolls Mania', 'Biryani Bell', 'Idli Street', 'Thatte Idli House', 'Filter Coffee Co', 'Chaat Chowk', 'Parathas & More', 'Momo Hut']
const CUSTOMERS = ['Divya', 'Nithin', 'Anil', 'Priyanka', 'Rahul', 'Sneha', 'Kiran', 'Meera', 'Arjun', 'Lakshmi']
const MENU: { name: string; category: ItemCategory; price: number }[] = [
  { name: 'Idli Vada', category: 'breakfast', price: 80 }, { name: 'Pongal', category: 'breakfast', price: 90 }, { name: 'Upma', category: 'breakfast', price: 70 },
  { name: 'Set Dosa', category: 'breakfast', price: 95 }, { name: 'Masala Dosa', category: 'all_day', price: 120 }, { name: 'Filter Coffee', category: 'all_day', price: 40 },
  { name: 'Veg Thali', category: 'lunch', price: 180 }, { name: 'Chicken Biryani', category: 'lunch', price: 260 }, { name: 'Paneer Roll', category: 'all_day', price: 150 },
  { name: 'Veg Momos', category: 'dinner', price: 130 }, { name: 'Croissant', category: 'breakfast', price: 110 }, { name: 'Cold Coffee', category: 'all_day', price: 160 },
]

export type SyntheticWorld = { outlets: Outlet[]; items: MenuItem[]; orders: Order[] }

/** The world for a workspace: outlets, items, 30 days of orders ending at `now`. Pure given the seed. */
export function buildWorld(workspaceId: string, now = Date.parse('2026-11-07T04:30:00Z'), seed = 20261107, days = 30): SyntheticWorld {
  const r = rng(seed)
  const outlets: Outlet[] = [{ id: 'out_cunningham_test', workspaceId, name: 'Tipplr Cunningham Road (Testing)', phoneNumbers: ['918310441698'], posIntegrated: false, timezone: 'Asia/Kolkata' }]
  for (let i = 1; i < 48; i++) {
    const base = OUTLET_NAMES[i % OUTLET_NAMES.length], area = AREAS[i % AREAS.length]
    outlets.push({ id: `out_${String(i).padStart(3, '0')}`, workspaceId, name: `${base}, ${area}`, phoneNumbers: [`9180000${String(10000 + i).slice(-5)}`], posIntegrated: i % 9 === 0, timezone: 'Asia/Kolkata' })
  }
  const items: MenuItem[] = []
  for (const o of outlets) for (const [j, m] of MENU.entries()) if (o.id === 'out_cunningham_test' || r() < 0.8) items.push({ id: `${o.id}_item_${j}`, outletId: o.id, name: m.name, category: m.category, available: true, availableUntil: null })
  const orders: Order[] = []
  let seq = 4000
  const dayMs = 86_400_000
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = now - d * dayMs - ((now - d * dayMs) % dayMs) // UTC midnight
    for (const o of outlets) {
      const menu = items.filter(i => i.outletId === o.id)
      const n = 10 + Math.floor(r() * 25) + (o.id === 'out_cunningham_test' ? 5 : 0)
      for (let k = 0; k < n; k++) {
        // IST business hours 7:00–22:30 → UTC 1:30–17:00
        const minuteUTC = 90 + Math.floor(r() * 930)
        const createdAt = new Date(dayStart + minuteUTC * 60_000).toISOString()
        const istHour = (minuteUTC + 330) / 60
        const breakfastWindow = istHour < 11.5
        const pool = breakfastWindow ? menu : menu.filter(i => i.category !== 'breakfast' || r() < 0.35)
        const lines: OrderLine[] = []
        const count = 1 + Math.floor(r() * 3)
        for (let c = 0; c < count; c++) { const it = pick(r, pool.length ? pool : menu); const priceM = MENU.find(m => m.name === it.name)!; lines.push({ itemId: it.id, name: it.name, qty: 1 + Math.floor(r() * 3), pricePaise: paise(priceM.price) }) }
        const amountPaise = lines.reduce((s, l) => s + l.qty * l.pricePaise, 0)
        const hasBreakfastAfterCutoff = !breakfastWindow && lines.some(l => menu.find(i => i.id === l.itemId)?.category === 'breakfast')
        let state: Order['state'] = 'delivered', cancelReason: CancelReason | null = null, outOfStockItemId: string | null = null
        const roll = r()
        if (hasBreakfastAfterCutoff && roll < 0.55) { state = 'cancelled'; cancelReason = 'out_of_stock'; outOfStockItemId = lines.find(l => menu.find(i => i.id === l.itemId)?.category === 'breakfast')!.itemId }
        else if (roll < 0.012) { state = 'cancelled'; cancelReason = 'out_of_stock'; outOfStockItemId = lines[0].itemId }
        else if (roll < 0.05 && istHour >= 21) { state = 'cancelled'; cancelReason = 'no_response' }
        else if (roll < 0.065) { state = 'cancelled'; cancelReason = 'rider_unavailable' }
        else if (roll < 0.075) { state = 'cancelled'; cancelReason = 'customer' }
        const pickupBy = new Date(Date.parse(createdAt) + 25 * 60_000).toISOString()
        orders.push({ id: `T-${seq++}`, outletId: o.id, source: r() < 0.6 ? 'flipkart' : 'ondc', items: lines, amountPaise, customerFirstName: pick(r, CUSTOMERS), area: pick(r, AREAS), prepaid: r() < 0.85, pickupBy, state, prepMinutes: state === 'delivered' ? 15 : null, cancelReason, outOfStockItemId, createdAt, updatedAt: createdAt })
      }
    }
  }
  // The live queue: a few orders in the last 10 minutes still 'new', for Cunningham Road (Testing).
  const live = orders.filter(o => o.outletId === 'out_cunningham_test').slice(-3)
  for (const o of live) { o.state = 'new'; o.cancelReason = null; o.outOfStockItemId = null; o.prepMinutes = null; o.createdAt = new Date(now - 5 * 60_000).toISOString(); o.updatedAt = o.createdAt; o.pickupBy = new Date(now + 22 * 60_000).toISOString() }
  return { outlets, items, orders: orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }
}

/** The adapter over the synthetic world. Writes mutate the world; reads see the mutation (that is the read-back). */
export class SyntheticAdapter implements TipplrAdapter {
  constructor(public world: SyntheticWorld, private failNext: Set<string> = new Set()) {}
  /** Test hook: the next write on this id fails with a 502 (no mutation), to prove outcome_unknown/failed handling. */
  failOnce(id: string) { this.failNext.add(id) }
  private fail(id: string) { if (this.failNext.has(id)) { this.failNext.delete(id); return { ok: false, status: 502, body: { error: 'upstream_timeout' } } } return null }
  async listOutlets() { return this.world.outlets }
  async listItems(outletId: string) { return this.world.items.filter(i => i.outletId === outletId) }
  async getItem(outletId: string, itemId: string) { return this.world.items.find(i => i.outletId === outletId && i.id === itemId) || null }
  async listOrders(outletId: string, sinceISO: string) { return this.world.orders.filter(o => o.outletId === outletId && o.createdAt >= sinceISO) }
  async listNewOrders(outletId: string) { return this.world.orders.filter(o => o.outletId === outletId && o.state === 'new') }
  async getOrder(orderId: string) { return this.world.orders.find(o => o.id === orderId) || null }
  async acceptOrder(orderId: string, prepMinutes: number) {
    const f = this.fail(orderId); if (f) return f
    const o = await this.getOrder(orderId); if (!o) return { ok: false, status: 404 }
    if (o.state !== 'new') return { ok: false, status: 409, body: { state: o.state } }
    o.state = 'accepted'; o.prepMinutes = prepMinutes; o.updatedAt = new Date().toISOString(); return { ok: true, status: 200, body: { id: o.id, state: o.state } }
  }
  async rejectOrder(orderId: string, reason: CancelReason) {
    const f = this.fail(orderId); if (f) return f
    const o = await this.getOrder(orderId); if (!o) return { ok: false, status: 404 }
    if (o.state !== 'new') return { ok: false, status: 409, body: { state: o.state } }
    o.state = 'rejected'; o.cancelReason = reason; o.updatedAt = new Date().toISOString(); return { ok: true, status: 200, body: { id: o.id, state: o.state } }
  }
  async setItemAvailability(outletId: string, itemId: string, available: boolean, untilISO: string | null = null) {
    const f = this.fail(itemId); if (f) return f
    const it = await this.getItem(outletId, itemId); if (!it) return { ok: false, status: 404 }
    it.available = available; it.availableUntil = available ? null : untilISO; return { ok: true, status: 200, body: { id: it.id, available: it.available } }
  }
}
