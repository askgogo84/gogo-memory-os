// Phase 3 — the ops side (screen 3): the 9:00 digest to the ops number, ledger questions, and "offer cut-offs to the
// top 3" as a draft that goes out only on "approve". Every figure is read from the ledger; nothing is estimated.
import type { Order, Outlet, TipplrAdapter } from './types'
import { inr } from './types'
import type { ScheduleStore } from './schedules'
import { proposalMessage } from './schedules'
import { cutoffProposal, dayStats } from './stock-rules'
import type { MerchantMessage } from './merchant-messages'
import type { Sender } from './meta-whatsapp'
import { attachEvidence, openActionRecord, receiptLine, recordVerification, transition, type ActionRecord } from '@/lib/agent/action-record'

const DAY = 86_400_000
const istDayStart = (now: number) => { const ist = now + 5.5 * 3_600_000; return ist - (ist % DAY) - 5.5 * 3_600_000 }
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

export type OutletOOS = { outlet: Outlet; oos: number; topItem: string | null; hasCutoff: boolean }
export type Digest = { day: string; outlets: number; orders: number; revenuePaise: number; cancelled: number; outOfStock: number; top: OutletOOS[] }

/** Yesterday across the workspace. */
export async function buildDigest(adapter: TipplrAdapter, store: ScheduleStore, now = Date.now()): Promise<Digest> {
  const to = istDayStart(now), from = to - DAY
  const outlets = await adapter.listOutlets()
  let orders = 0, revenuePaise = 0, cancelled = 0, outOfStock = 0
  const per: OutletOOS[] = []
  for (const o of outlets) {
    const list = await adapter.listOrders(o.id, new Date(from).toISOString())
    const s = dayStats(o.id, list, new Date(from).toISOString(), new Date(to).toISOString())
    orders += s.orders; revenuePaise += s.revenuePaise; cancelled += s.cancelled; outOfStock += s.outOfStock
    per.push({ outlet: o, oos: s.outOfStock, topItem: s.outOfStockItems[0]?.name || null, hasCutoff: (await store.list(o.id)).some(x => x.active) })
  }
  return { day: fmtDay(from), outlets: outlets.length, orders, revenuePaise, cancelled, outOfStock, top: per.sort((a, b) => b.oos - a.oos).slice(0, 3) }
}

/** Screen 3's first message. Pure. */
export function formatDigest(d: Digest): string {
  const pct = d.orders ? Math.round(d.cancelled / d.orders * 100) : 0
  const lines = [`${d.day} · ${d.outlets} pilot outlets`, `Orders ${d.orders.toLocaleString('en-IN')} · ${inr(d.revenuePaise)} · Cancelled ${d.cancelled} (${pct}%) · Out of stock ${d.outOfStock} of ${d.cancelled}`]
  if (d.top.some(t => t.oos > 0)) {
    lines.push('', '*Top out-of-stock cancellers*', ...d.top.filter(t => t.oos > 0).map((t, i) => `${i + 1}. ${t.outlet.name} · ${t.oos}${t.topItem ? ` · ${t.topItem}` : ''}`))
    const none = d.top.filter(t => t.oos > 0 && !t.hasCutoff)
    if (none.length) lines.push(none.length === d.top.filter(t => t.oos > 0).length ? `None of the ${none.length} has a breakfast cut-off set.` : `${none.map(n => n.outlet.name.split(',')[0]).join(' and ')} ${none.length === 1 ? 'has' : 'have'} no cut-off set.`, 'Say "offer cut-offs to the top 3" and I\'ll send each the breakfast question.')
  }
  return lines.join('\n')
}

/** "cancellations this week by reason". Pure given the orders. */
export function reasonsReply(orders: Order[], now = Date.now(), days = 7): string {
  const since = new Date(now - days * DAY).toISOString()
  const c = orders.filter(o => o.state === 'cancelled' && o.createdAt >= since)
  const by = (r: string) => c.filter(o => o.cancelReason === r).length
  const n = c.length || 1
  const noResp = c.filter(o => o.cancelReason === 'no_response')
  const late = noResp.filter(o => { const h = (Date.parse(o.createdAt) / 3_600_000 + 5.5) % 24; return h >= 21 && h < 22.5 })
  const outlets = new Set(late.map(o => o.outletId)).size
  const lines = [`*Last ${days} days:* ${c.length} cancellations. Out of stock ${by('out_of_stock')} (${Math.round(by('out_of_stock') / n * 100)}%) · merchant didn't respond ${by('no_response')} (${Math.round(by('no_response') / n * 100)}%) · rider unavailable ${by('rider_unavailable')} · customer ${by('customer')}.`]
  if (late.length >= 5 && outlets) lines.push(`"Didn't respond" is concentrated in ${outlets} outlet${outlets === 1 ? '' : 's'} between 9 and 10:30 pm. Want the list?`)
  return lines.join('\n')
}

export const OPS_ASK = {
  digest: /^(?:digest|morning digest|yesterday|how was yesterday)\??$/i,
  reasons: /^cancellations?\s+(?:this|last)\s+week\s+by\s+reason\??$|^why\s+(?:are|were)\s+orders\s+cancell?ed\??$/i,
  offer: /^offer\s+cut-?offs?\s+to\s+(?:the\s+)?top\s*(\d)$/i,
  approve: /^approve$/i,
  todayAt: /^how many orders today at\s+(.+?)\??$/i,
}

/** Drafts the top-N proposals; nothing is sent until "approve". */
export async function draftOffers(adapter: TipplrAdapter, store: ScheduleStore, n: number, now = Date.now()): Promise<{ outlet: Outlet; message: MerchantMessage }[]> {
  const d = await buildDigest(adapter, store, now)
  const out: { outlet: Outlet; message: MerchantMessage }[] = []
  for (const t of d.top.slice(0, n)) {
    if (t.hasCutoff || t.outlet.posIntegrated || !t.outlet.phoneNumbers.length) continue
    const items = await adapter.listItems(t.outlet.id)
    const history = await adapter.listOrders(t.outlet.id, new Date(now - 7 * DAY).toISOString())
    const p = cutoffProposal(t.outlet.id, history, items, now)
    if (p) out.push({ outlet: t.outlet, message: proposalMessage(t.outlet.id, p) })
  }
  return out
}

export type OpsPending = { kind: 'offers'; drafts: { outletId: string; phone: string; message: MerchantMessage }[]; at: string }

/** The ops number's asks. `pending` holds the last draft awaiting "approve". */
export async function handleOpsInput(adapter: TipplrAdapter, store: ScheduleStore, text: string, send: Sender, pending: { get(): Promise<OpsPending | null>; set(p: OpsPending | null): Promise<void> }, persist: (r: ActionRecord) => Promise<void>, now = Date.now()): Promise<string | null> {
  const t = text.trim()
  if (OPS_ASK.digest.test(t)) return formatDigest(await buildDigest(adapter, store, now))
  if (OPS_ASK.reasons.test(t)) { const all: Order[] = []; for (const o of await adapter.listOutlets()) all.push(...await adapter.listOrders(o.id, new Date(now - 7 * DAY).toISOString())); return reasonsReply(all, now) }
  let m: RegExpMatchArray | null
  if ((m = t.match(OPS_ASK.todayAt))) {
    const name = m[1].toLowerCase(); const outlet = (await adapter.listOutlets()).find(o => o.name.toLowerCase().includes(name))
    if (!outlet) return `I don't have an outlet matching "${m[1]}".`
    const { todayReply } = await import('./actions'); return todayReply(outlet.id, await adapter.listOrders(outlet.id, new Date(now - 2 * DAY).toISOString()), now)
  }
  if ((m = t.match(OPS_ASK.offer))) {
    const drafts = await draftOffers(adapter, store, Number(m[1]), now)
    if (!drafts.length) return 'Nothing to offer: the top outlets already have a cut-off, are POS-managed, or have no number.'
    await pending.set({ kind: 'offers', drafts: drafts.map(d => ({ outletId: d.outlet.id, phone: d.outlet.phoneNumbers[0], message: d.message })), at: new Date(now).toISOString() })
    return `Needs approval\nDraft for ${drafts.length} outlet${drafts.length === 1 ? '' : 's'}: ${drafts.map(d => d.outlet.name).join(' · ')}.\nEach gets the breakfast cut-off question with Yes every day / Only today / No. Reply "approve" to send, or "cancel".`
  }
  if (OPS_ASK.approve.test(t)) {
    const p = await pending.get()
    if (!p || now - Date.parse(p.at) > 30 * 60_000) return 'There is nothing waiting for approval.'
    await pending.set(null)
    const lines: string[] = []
    for (const d of p.drafts) {
      let rec = transition(openActionRecord({ telegramId: 'ops', capability: 'merchant', action: 'merchant.offer.cutoff', request: `offer cut-off to ${d.outletId}`, policy: { capability: 'merchant', permissionLevel: 'ask', mode: 'execute', risk: 'medium', irreversible: true } }), 'running', { note: 'ops_approve' })
      const r = await send(d.phone, d.message)
      rec = attachEvidence(rec, { provider: 'meta.whatsapp', ids: { messageId: String(r.id || '') }, httpStatus: r.status, note: r.error || null })
      rec = recordVerification(rec, r.ok && r.id ? { state: 'verified_completed', evidence: { messageId: r.id } } : r.ok ? { state: 'still_unknown', evidence: { status: r.status }, reason: 'no_message_id' } : { state: 'verified_absent', evidence: { status: r.status, error: r.error } })
      await persist(rec)
      lines.push(receiptLine(rec, `offer sent to ${d.outletId}`))
    }
    return lines.join('\n')
  }
  if (/^cancel$/i.test(t)) { await pending.set(null); return 'Cancelled; nothing sent.' }
  return null
}
