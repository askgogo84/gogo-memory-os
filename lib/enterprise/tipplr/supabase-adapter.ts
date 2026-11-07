// The TipplrAdapter over the pilot's own tables (migration 20261107160000). The synthetic world is seeded into them
// once (scripts/seed-tipplr-pilot.mts, owner-run), so cron runs on Vercel see the same orders between invocations.
// A missing table throws pilot_not_enabled: the routes answer 503 and nothing else happens.
import type { CancelReason, MenuItem, Order, Outlet, TipplrAdapter } from './types'

type Db = { from: (t: string) => any }
const missing = (e: any) => /does not exist|42P01|PGRST205/i.test(String(e?.message || e?.code || ''))

export class SupabaseAdapter implements TipplrAdapter {
  constructor(private db: Db, private workspaceId: string) {}
  private check(error: any, ctx: string) { if (!error) return; if (missing(error)) throw new Error('pilot_not_enabled'); console.error('TIPPLR_PILOT_DB_FAILED:', ctx, String(error.message || '').slice(0, 160)); throw new Error('pilot_db_failed') }
  private outlet = (r: any): Outlet => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, phoneNumbers: r.phone_numbers || [], posIntegrated: !!r.pos_integrated, timezone: r.timezone || 'Asia/Kolkata' })
  private item = (r: any): MenuItem => ({ id: r.id, outletId: r.outlet_id, name: r.name, category: r.category, available: !!r.available, availableUntil: r.available_until })
  private order = (r: any): Order => ({ id: r.id, outletId: r.outlet_id, source: r.source, items: r.items || [], amountPaise: Number(r.amount_paise), customerFirstName: r.customer_first_name || '', area: r.area || '', prepaid: !!r.prepaid, pickupBy: r.pickup_by, state: r.state, prepMinutes: r.prep_minutes, cancelReason: r.cancel_reason, outOfStockItemId: r.items?.find?.((l: any) => l.outOfStock)?.itemId ?? null, createdAt: r.created_at, updatedAt: r.updated_at })

  async listOutlets() { const { data, error } = await this.db.from('merchant_outlets').select('*').eq('workspace_id', this.workspaceId); this.check(error, 'outlets'); return (data || []).map(this.outlet) }
  async listItems(outletId: string) { const { data, error } = await this.db.from('merchant_items').select('*').eq('outlet_id', outletId); this.check(error, 'items'); return (data || []).map(this.item) }
  async getItem(outletId: string, itemId: string) { const { data, error } = await this.db.from('merchant_items').select('*').eq('outlet_id', outletId).eq('id', itemId).maybeSingle(); this.check(error, 'item'); return data ? this.item(data) : null }
  async listOrders(outletId: string, sinceISO: string) { const { data, error } = await this.db.from('merchant_orders').select('*').eq('outlet_id', outletId).gte('created_at', sinceISO).order('created_at', { ascending: true }).limit(2000); this.check(error, 'orders'); return (data || []).map(this.order) }
  async listNewOrders(outletId: string) { const { data, error } = await this.db.from('merchant_orders').select('*').eq('outlet_id', outletId).eq('state', 'new').order('created_at', { ascending: true }).limit(50); this.check(error, 'new_orders'); return (data || []).map(this.order) }
  async getOrder(orderId: string) { const { data, error } = await this.db.from('merchant_orders').select('*').eq('id', orderId).maybeSingle(); this.check(error, 'order'); return data ? this.order(data) : null }
  /** Compare-and-set on state = new, so a second tap or a Tipplr-side change cannot be overwritten (409). */
  private async move(orderId: string, patch: Record<string, unknown>) {
    const { data, error } = await this.db.from('merchant_orders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', orderId).eq('state', 'new').select('id,state').maybeSingle()
    if (error) { if (missing(error)) throw new Error('pilot_not_enabled'); return { ok: false, status: 502, body: { error: String(error.message || '').slice(0, 80) } } }
    if (!data) { const cur = await this.getOrder(orderId); return cur ? { ok: false, status: 409, body: { state: cur.state } } : { ok: false, status: 404 } }
    return { ok: true, status: 200, body: data }
  }
  acceptOrder(orderId: string, prepMinutes: number) { return this.move(orderId, { state: 'accepted', prep_minutes: prepMinutes }) }
  rejectOrder(orderId: string, reason: CancelReason) { return this.move(orderId, { state: 'rejected', cancel_reason: reason }) }
  async setItemAvailability(outletId: string, itemId: string, available: boolean, untilISO: string | null = null) {
    const { data, error } = await this.db.from('merchant_items').update({ available, available_until: available ? null : untilISO, updated_at: new Date().toISOString() }).eq('outlet_id', outletId).eq('id', itemId).select('id,available').maybeSingle()
    if (error) { if (missing(error)) throw new Error('pilot_not_enabled'); return { ok: false, status: 502, body: { error: String(error.message || '').slice(0, 80) } } }
    return data ? { ok: true, status: 200, body: data } : { ok: false, status: 404 }
  }
}

/** Rows for the seed script: the synthetic world as table rows. Pure. */
export function worldToRows(world: { outlets: Outlet[]; items: MenuItem[]; orders: Order[] }) {
  return {
    merchant_outlets: world.outlets.map(o => ({ id: o.id, workspace_id: o.workspaceId, name: o.name, phone_numbers: o.phoneNumbers, pos_integrated: o.posIntegrated, timezone: o.timezone })),
    merchant_items: world.items.map(i => ({ id: i.id, outlet_id: i.outletId, name: i.name, category: i.category, available: i.available, available_until: i.availableUntil })),
    merchant_orders: world.orders.map(o => ({ id: o.id, outlet_id: o.outletId, source: o.source, items: o.items.map(l => ({ ...l, outOfStock: o.outOfStockItemId === l.itemId || undefined })), amount_paise: o.amountPaise, customer_first_name: o.customerFirstName, area: o.area, prepaid: o.prepaid, pickup_by: o.pickupBy, state: o.state, prep_minutes: o.prepMinutes, cancel_reason: o.cancelReason, created_at: o.createdAt, updated_at: o.updatedAt })),
  }
}
