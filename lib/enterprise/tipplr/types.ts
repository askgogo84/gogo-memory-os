// AskGogo Enterprise — Tipplr ops pilot (mock approved 7 Nov 2026). Shared types.
// Ids are strings end to end: Tipplr's own ids arrive later and never pass through Number.
export type OrderSource = 'flipkart' | 'ondc'
export type OrderState = 'new' | 'accepted' | 'rejected' | 'cancelled' | 'picked_up' | 'delivered'
export type CancelReason = 'out_of_stock' | 'no_response' | 'rider_unavailable' | 'customer'
export type ItemCategory = 'breakfast' | 'lunch' | 'dinner' | 'all_day'

export type Outlet = { id: string; workspaceId: string; name: string; phoneNumbers: string[]; posIntegrated: boolean; timezone: string }
export type MenuItem = { id: string; outletId: string; name: string; category: ItemCategory; available: boolean; availableUntil: string | null }
export type OrderLine = { itemId: string; name: string; qty: number; pricePaise: number }
export type Order = {
  id: string; outletId: string; source: OrderSource; items: OrderLine[]; amountPaise: number
  customerFirstName: string; area: string; prepaid: boolean; pickupBy: string; state: OrderState
  prepMinutes: number | null; cancelReason: CancelReason | null
  /** The item the merchant named as out of stock, when the cancellation says; else null and every line counts. */
  outOfStockItemId?: string | null
  createdAt: string; updatedAt: string
}
export type OrderEvent = { orderId: string; kind: string; detail: Record<string, unknown>; actor: 'merchant' | 'ops' | 'gogo' | 'system'; actionRecordId: string | null; at: string }

/** Everything the pilot may do to Tipplr, behind one interface. The synthetic adapter carries the pilot. */
export interface TipplrAdapter {
  listOutlets(): Promise<Outlet[]>
  listItems(outletId: string): Promise<MenuItem[]>
  getItem(outletId: string, itemId: string): Promise<MenuItem | null>
  listOrders(outletId: string, sinceISO: string): Promise<Order[]>
  listNewOrders(outletId: string): Promise<Order[]>
  getOrder(orderId: string): Promise<Order | null>
  acceptOrder(orderId: string, prepMinutes: number): Promise<{ ok: boolean; status: number; body?: unknown }>
  rejectOrder(orderId: string, reason: CancelReason): Promise<{ ok: boolean; status: number; body?: unknown }>
  setItemAvailability(outletId: string, itemId: string, available: boolean, untilISO?: string | null): Promise<{ ok: boolean; status: number; body?: unknown }>
}

export const paise = (rupees: number) => Math.round(rupees * 100)
/** ₹6,840 · ₹3.9 L. Indian grouping. Pure. */
export function inr(paiseAmount: number): string {
  const r = Math.round(paiseAmount / 100)
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(r >= 1_000_000 ? 0 : 1)} L`
  return `₹${r.toLocaleString('en-IN')}`
}
export const hhmm = (iso: string, tz = 'Asia/Kolkata') => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/\s?([ap])m$/i, ' $1m').toLowerCase()
