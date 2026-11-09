// Phase 4 — the adapter over Tipplr's own APIs. Endpoints are NOT known to this repo: they come from the Tipplr
// backend (Nithin's repos) and are set as env, never guessed. Until every path is set, the adapter reports
// not_configured and the pilot keeps running on the Supabase adapter. Only the two existing write APIs Gogo named
// (accept order, item availability) plus their reads are wrapped; nothing else is called.
import type { CancelReason, MenuItem, Order, Outlet, TipplrAdapter } from './types'

export type TipplrConfig = { baseUrl: string; authHeader: string; paths: { outlets: string; items: string; item: string; orders: string; order: string; accept: string; reject: string; availability: string } }

/** Reads the config from env; null unless every piece is present. Pure given env. */
export function tipplrConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TipplrConfig | null {
  const baseUrl = env.TIPPLR_API_BASE_URL, authHeader = env.TIPPLR_API_AUTH_HEADER
  const paths = { outlets: env.TIPPLR_PATH_OUTLETS, items: env.TIPPLR_PATH_ITEMS, item: env.TIPPLR_PATH_ITEM, orders: env.TIPPLR_PATH_ORDERS, order: env.TIPPLR_PATH_ORDER, accept: env.TIPPLR_PATH_ACCEPT, reject: env.TIPPLR_PATH_REJECT, availability: env.TIPPLR_PATH_AVAILABILITY }
  if (!baseUrl || !authHeader || Object.values(paths).some(p => !p)) return null
  if (!/^https:\/\//.test(baseUrl)) return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), authHeader, paths: paths as TipplrConfig['paths'] }
}

/** `{outletId}` / `{orderId}` / `{itemId}` placeholders in a path. Pure. */
export const fillPath = (path: string, vars: Record<string, string>) => path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''))

type Mapper = { outlet: (raw: any) => Outlet; item: (raw: any) => MenuItem; order: (raw: any) => Order }

export class TipplrHttpAdapter implements TipplrAdapter {
  constructor(private cfg: TipplrConfig, private workspaceId: string, private map: Mapper, private fetchImpl: typeof fetch = fetch) {}
  private async call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) {
    try {
      const r = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { method, headers: { Authorization: this.cfg.authHeader, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const json: any = await r.json().catch(() => null)
      return { ok: r.ok, status: r.status, body: json }
    } catch (err: any) { return { ok: false, status: 0, body: { error: String(err?.message || err).slice(0, 120) } } }
  }
  private list = (b: any) => Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : Array.isArray(b?.items) ? b.items : []
  async listOutlets() { const r = await this.call('GET', this.cfg.paths.outlets); return r.ok ? this.list(r.body).map(this.map.outlet).map(o => ({ ...o, workspaceId: this.workspaceId })) : [] }
  async listItems(outletId: string) { const r = await this.call('GET', fillPath(this.cfg.paths.items, { outletId })); return r.ok ? this.list(r.body).map(this.map.item) : [] }
  async getItem(outletId: string, itemId: string) { const r = await this.call('GET', fillPath(this.cfg.paths.item, { outletId, itemId })); return r.ok && r.body ? this.map.item(r.body.data ?? r.body) : null }
  async listOrders(outletId: string, sinceISO: string) { const r = await this.call('GET', `${fillPath(this.cfg.paths.orders, { outletId })}${this.cfg.paths.orders.includes('?') ? '&' : '?'}since=${encodeURIComponent(sinceISO)}`); return r.ok ? this.list(r.body).map(this.map.order) : [] }
  async listNewOrders(outletId: string) { return (await this.listOrders(outletId, new Date(Date.now() - 3_600_000).toISOString())).filter(o => o.state === 'new') }
  async getOrder(orderId: string) { const r = await this.call('GET', fillPath(this.cfg.paths.order, { orderId })); return r.ok && r.body ? this.map.order(r.body.data ?? r.body) : null }
  acceptOrder(orderId: string, prepMinutes: number) { return this.call('POST', fillPath(this.cfg.paths.accept, { orderId }), { prepMinutes }) }
  rejectOrder(orderId: string, reason: CancelReason) { return this.call('POST', fillPath(this.cfg.paths.reject, { orderId }), { reason }) }
  setItemAvailability(outletId: string, itemId: string, available: boolean, untilISO: string | null = null) { return this.call('PATCH', fillPath(this.cfg.paths.availability, { outletId, itemId }), { available, until: untilISO }) }
}
