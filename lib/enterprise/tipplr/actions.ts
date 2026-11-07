// The three writes the pilot may make, each through one action record: approval (the merchant's tap) → running →
// adapter write → evidence → read-back → verified_success | failed | outcome_unknown → the receipt the merchant reads.
// Nothing here retries an unknown outcome. POS-integrated outlets refuse availability writes before any call.
import { attachEvidence, openActionRecord, recordVerification, transition, type ActionRecord } from '@/lib/agent/action-record'
import type { CancelReason, Order, Outlet, TipplrAdapter } from './types'
import { acceptReceipt, availabilityReceipt, markOutOfStockOffer, newOrderMessage, POS_REFUSAL, rejectReceipt, type MerchantMessage } from './merchant-messages'
import { cutoffProposal, dayStats, stockFlags } from './stock-rules'
import { inr } from './types'

export type Persist = (rec: ActionRecord) => Promise<void>
const noPersist: Persist = async () => {}

const policy = { capability: 'merchant' as const, permissionLevel: 'ask' as const, mode: 'execute' as const, risk: 'medium' as const, irreversible: true }

/** A tap on a button is the approval: the record opens awaiting_approval and moves to running at once. */
function approvedRecord(telegramId: string, action: string, request: string): ActionRecord {
  const rec = openActionRecord({ telegramId, capability: 'merchant', action, request, policy })
  return transition(rec, 'running', { note: 'merchant_tap' })
}

export async function acceptOrder(adapter: TipplrAdapter, telegramId: string, orderId: string, prepMinutes: number, persist: Persist = noPersist): Promise<{ record: ActionRecord; text: string; order: Order | null }> {
  let rec = approvedRecord(telegramId, 'merchant.order.accept', `accept ${orderId} ${prepMinutes} min`)
  const res = await adapter.acceptOrder(orderId, prepMinutes)
  rec = attachEvidence(rec, { provider: 'tipplr.orders', ids: { orderId, prepMinutes: String(prepMinutes) }, httpStatus: res.status, note: res.ok ? null : JSON.stringify(res.body || {}).slice(0, 120) })
  const back = await adapter.getOrder(orderId).catch(() => null)
  // A 409 means the order had already moved (a second tap, or Tipplr acted first): nothing changed, say so plainly.
  if (res.status === 409 && back) { rec = transition(rec, 'failed', { error: `already_${back.state}` }); await persist(rec); return { record: rec, text: `#${orderId} is already ${back.state}${back.prepMinutes ? ` (${back.prepMinutes} min)` : ''}. Nothing changed.`, order: back } }
  if (back?.state === 'accepted' && back.prepMinutes === prepMinutes) rec = recordVerification(rec, { state: 'verified_completed', evidence: { state: back.state, prepMinutes: back.prepMinutes } })
  else if (!res.ok && back && back.state === 'new') rec = recordVerification(rec, { state: 'verified_absent', evidence: { state: back.state, status: res.status } })
  else rec = recordVerification(rec, { state: 'still_unknown', evidence: { state: back?.state ?? null, prepMinutes: back?.prepMinutes ?? null, status: res.status }, reason: back ? 'state_not_accepted' : 'read_back_failed' })
  await persist(rec)
  return { record: rec, text: back ? acceptReceipt(rec, back) : acceptReceipt(rec, { id: orderId } as Order), order: back }
}

export async function rejectOrder(adapter: TipplrAdapter, telegramId: string, orderId: string, reason: CancelReason, persist: Persist = noPersist): Promise<{ record: ActionRecord; text: string; followUp: MerchantMessage | null; order: Order | null }> {
  let rec = approvedRecord(telegramId, 'merchant.order.reject', `reject ${orderId} ${reason}`)
  const res = await adapter.rejectOrder(orderId, reason)
  rec = attachEvidence(rec, { provider: 'tipplr.orders', ids: { orderId, reason }, httpStatus: res.status })
  const back = await adapter.getOrder(orderId).catch(() => null)
  if (res.status === 409 && back) { rec = transition(rec, 'failed', { error: `already_${back.state}` }); await persist(rec); return { record: rec, text: `#${orderId} is already ${back.state}. Nothing changed.`, followUp: null, order: back } }
  if (back?.state === 'rejected') rec = recordVerification(rec, { state: 'verified_completed', evidence: { state: back.state } })
  else if (!res.ok && back && back.state === 'new') rec = recordVerification(rec, { state: 'verified_absent', evidence: { state: back.state, status: res.status } })
  else rec = recordVerification(rec, { state: 'still_unknown', evidence: { state: back?.state ?? null, status: res.status }, reason: back ? 'state_not_rejected' : 'read_back_failed' })
  await persist(rec)
  const r = reason === 'out_of_stock' ? 'out_of_stock' : 'no_response'
  const followUp = rec.state === 'verified_success' && reason === 'out_of_stock' && back ? markOutOfStockOffer(back, back.items[0].name) : null
  return { record: rec, text: rejectReceipt(rec, back || ({ id: orderId } as Order), r), followUp, order: back }
}

export async function setAvailability(adapter: TipplrAdapter, telegramId: string, outlet: Outlet, itemName: string, available: boolean, untilHourIST: number | null, persist: Persist = noPersist, now = Date.now()): Promise<{ record: ActionRecord | null; text: string }> {
  if (outlet.posIntegrated) return { record: null, text: POS_REFUSAL }
  const items = await adapter.listItems(outlet.id)
  const item = items.find(i => i.name.toLowerCase() === itemName.toLowerCase())
  if (!item) return { record: null, text: `I don't see "${itemName}" on ${outlet.name}'s Tipplr menu, so there's nothing to change.` }
  let rec = approvedRecord(telegramId, 'merchant.item.availability', `${available ? 'on' : 'off'} ${itemName} @ ${outlet.id}`)
  const until = !available && untilHourIST !== null ? new Date(new Date(now + 5.5 * 3_600_000).setUTCHours(untilHourIST, 0, 0, 0) - 5.5 * 3_600_000).toISOString() : null
  const res = await adapter.setItemAvailability(outlet.id, item.id, available, until)
  rec = attachEvidence(rec, { provider: 'tipplr.items', ids: { itemId: item.id }, httpStatus: res.status })
  const back = await adapter.getItem(outlet.id, item.id).catch(() => null)
  if (back && back.available === available) rec = recordVerification(rec, { state: 'verified_completed', evidence: { available: back.available, until: back.availableUntil } })
  else if (!res.ok && back && back.available !== available) rec = recordVerification(rec, { state: 'verified_absent', evidence: { available: back.available, status: res.status } })
  else rec = recordVerification(rec, { state: 'still_unknown', evidence: { available: back?.available ?? null, status: res.status }, reason: back ? 'availability_mismatch' : 'read_back_failed' })
  await persist(rec)
  return { record: rec, text: availabilityReceipt(rec, item.name, available, untilHourIST ?? undefined) }
}

/** Compose the message for a new order, using the outlet's last 2 days to decide on the stock check. */
export async function composeNewOrder(adapter: TipplrAdapter, order: Order, now = Date.now()): Promise<MerchantMessage> {
  const history = await adapter.listOrders(order.outletId, new Date(now - 2 * 86_400_000).toISOString())
  return newOrderMessage(order, stockFlags(order, history, now), 'Asia/Kolkata')
}

/** "how many orders today" from the ledger, with yesterday at the same time. Pure given the orders. */
export function todayReply(outletId: string, orders: Order[], now = Date.now()): string {
  const ist = now + 5.5 * 3_600_000
  const startIST = ist - (ist % 86_400_000)
  const todayFrom = new Date(startIST - 5.5 * 3_600_000).toISOString(), nowISO = new Date(now).toISOString()
  const t = dayStats(outletId, orders, todayFrom, nowISO)
  const y = dayStats(outletId, orders, new Date(Date.parse(todayFrom) - 86_400_000).toISOString(), new Date(now - 86_400_000).toISOString())
  const rejected = t.rejected + t.outOfStock
  const why = t.outOfStockItems.length ? ` (out of stock: ${t.outOfStockItems.slice(0, 2).map(x => `${x.name} ${x.count}`).join(', ')})` : ''
  return `*Today so far:* ${t.orders} orders, ${inr(t.revenuePaise)}. ${t.accepted} accepted, ${rejected} not fulfilled${why}. Yesterday at this time: ${y.orders} orders, ${inr(y.revenuePaise)}.`
}

/** Outlet for a WhatsApp number; null means the number is on no outlet and gets no data. Pure. */
export const outletForPhone = (outlets: Outlet[], phone: string) => { const d = phone.replace(/\D/g, '').slice(-12); return outlets.find(o => o.phoneNumbers.some(p => p.replace(/\D/g, '').slice(-12) === d)) || null }

/** The router for a merchant's tap or text. Button ids: accept:<order>:<min> · reject:<order>:<reason> · oos:<outlet>:<item>:<hour>. */
export async function handleMerchantInput(adapter: TipplrAdapter, fromPhone: string, input: string, persist: Persist = noPersist, now = Date.now(), store?: import('./schedules').ScheduleStore): Promise<{ texts: string[]; buttons?: MerchantMessage['buttons'] } | null> {
  const outlets = await adapter.listOutlets()
  const outlet = outletForPhone(outlets, fromPhone)
  if (!outlet) return null
  const tg = `merchant:${outlet.id}`
  const t = input.trim()
  let m: RegExpMatchArray | null
  // Phase 2: the cut-off proposal's buttons and the schedule edits (screen 2).
  if (store && (m = t.match(/^cutoff:([A-Za-z0-9_-]+):(daily|today|no)$/))) {
    if (m[1] !== outlet.id) return { texts: ['That proposal belongs to another outlet.'] }
    const sch = await import('./schedules')
    const items = await adapter.listItems(outlet.id)
    const history = await adapter.listOrders(outlet.id, new Date(now - 7 * 86_400_000).toISOString())
    const p = cutoffProposal(outlet.id, history, items, now)
    if (!p) return { texts: ['The pattern is gone this week, so there is nothing to schedule.'] }
    return { texts: [await sch.applyCutoffChoice(adapter, store, outlet, m[2] as 'daily' | 'today' | 'no', p, persist, now)] }
  }
  if (store) { const sch = await import('./schedules'); const edited = await sch.editSchedule(adapter, store, outlet, t, persist, now); if (edited) return { texts: [edited] } }
  if ((m = t.match(/^accept:([A-Za-z0-9-]+):(\d{1,3})$/))) { const r = await acceptOrder(adapter, tg, m[1], Number(m[2]), persist); return { texts: [r.text] } }
  if ((m = t.match(/^reject:([A-Za-z0-9-]+):(out_of_stock|no_response)$/))) { const r = await rejectOrder(adapter, tg, m[1], m[2] as CancelReason, persist); return r.followUp ? { texts: [r.text, r.followUp.text], buttons: r.followUp.buttons } : { texts: [r.text] } }
  if ((m = t.match(/^oos:([A-Za-z0-9_-]+):([^:]+):(\d{1,2})$/))) { if (m[1] !== outlet.id) return { texts: ['That item belongs to another outlet.'] }; const r = await setAvailability(adapter, tg, outlet, decodeURIComponent(m[2]), false, Number(m[3]), persist, now); return { texts: [r.text] } }
  if (/^(?:turn|put|mark)\s+(.+?)\s+back\s+on$|^(.+?)\s+(?:is\s+)?back\s+(?:on|in stock)$/i.test(t)) { const name = (t.match(/^(?:turn|put|mark)\s+(.+?)\s+back\s+on$/i)?.[1] || t.match(/^(.+?)\s+(?:is\s+)?back\s+(?:on|in stock)$/i)?.[1] || '').trim(); const r = await setAvailability(adapter, tg, outlet, name, true, null, persist, now); return { texts: [r.text] } }
  if (/^(?:how many orders|orders)\s+(?:today|so far)\??$|^today'?s orders\??$/i.test(t)) { const orders = await adapter.listOrders(outlet.id, new Date(now - 2 * 86_400_000).toISOString()); return { texts: [todayReply(outlet.id, orders, now)] } }
  if (/^noop$/.test(t)) return { texts: ['Left as is.'] }
  return null
}
