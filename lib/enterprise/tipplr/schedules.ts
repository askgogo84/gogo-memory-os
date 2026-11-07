// Phase 2 — breakfast cut-off schedule (screen 2 of the approved mock). The rule proposes; the merchant approves once;
// every run turns items off/on through the same availability action (one action record per item, read back), and
// one message per outlet says what changed. "keep pongal on" edits the schedule; "no" is silence for 7 days.
import type { ActionRecord } from '@/lib/agent/action-record'
import type { MenuItem, Order, Outlet, TipplrAdapter } from './types'
import { cutoffProposal, type CutoffProposal } from './stock-rules'
import { setAvailability, type Persist } from './actions'
import type { MerchantMessage } from './merchant-messages'

export type Schedule = { id: string; outletId: string; itemIds: string[]; offAt: string; onAt: string; active: boolean; createdBy: string; createdAt: string; lastRunAt: string | null; lastResult: Record<string, unknown> | null; snoozedUntil?: string | null }
export interface ScheduleStore {
  list(outletId?: string): Promise<Schedule[]>
  save(s: Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastResult'>): Promise<Schedule>
  update(id: string, patch: Partial<Schedule>): Promise<Schedule | null>
  snooze(outletId: string, untilISO: string): Promise<void>
  snoozedUntil(outletId: string): Promise<string | null>
}

export class MemoryScheduleStore implements ScheduleStore {
  rows: Schedule[] = []; snoozes = new Map<string, string>(); private seq = 1
  async list(outletId?: string) { return this.rows.filter(r => !outletId || r.outletId === outletId) }
  async save(s: Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastResult'>) { const row: Schedule = { ...s, id: `sch_${this.seq++}`, createdAt: new Date().toISOString(), lastRunAt: null, lastResult: null }; this.rows.push(row); return row }
  async update(id: string, patch: Partial<Schedule>) { const r = this.rows.find(x => x.id === id); if (!r) return null; Object.assign(r, patch); return r }
  async snooze(outletId: string, untilISO: string) { this.snoozes.set(outletId, untilISO) }
  async snoozedUntil(outletId: string) { return this.snoozes.get(outletId) || null }
}

/** Supabase-backed store over merchant_schedules (migration 20261107160000). A missing table throws pilot_not_enabled. */
export class SupabaseScheduleStore implements ScheduleStore {
  constructor(private db: { from: (t: string) => any }) {}
  private check(error: any) { if (!error) return; if (/does not exist|42P01|PGRST205/i.test(String(error.message || error.code || ''))) throw new Error('pilot_not_enabled'); throw new Error(String(error.message || 'schedule_store_failed')) }
  private row = (r: any): Schedule => ({ id: r.id, outletId: r.outlet_id, itemIds: r.item_ids || [], offAt: String(r.off_at).slice(0, 5), onAt: String(r.on_at).slice(0, 5), active: !!r.active, createdBy: r.created_by, createdAt: r.created_at, lastRunAt: r.last_run_at, lastResult: r.last_result, snoozedUntil: r.last_result?.snoozedUntil ?? null })
  async list(outletId?: string) { let q = this.db.from('merchant_schedules').select('*'); if (outletId) q = q.eq('outlet_id', outletId); const { data, error } = await q; this.check(error); return (data || []).map(this.row) }
  async save(s: Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastResult'>) { const { data, error } = await this.db.from('merchant_schedules').insert({ outlet_id: s.outletId, item_ids: s.itemIds, off_at: s.offAt, on_at: s.onAt, active: s.active, created_by: s.createdBy }).select('*').single(); this.check(error); return this.row(data) }
  async update(id: string, patch: Partial<Schedule>) { const p: any = {}; if (patch.itemIds) p.item_ids = patch.itemIds; if (patch.active !== undefined) p.active = patch.active; if (patch.lastRunAt !== undefined) p.last_run_at = patch.lastRunAt; if (patch.lastResult !== undefined) p.last_result = patch.lastResult; const { data, error } = await this.db.from('merchant_schedules').update(p).eq('id', id).select('*').maybeSingle(); this.check(error); return data ? this.row(data) : null }
  async snooze(outletId: string, untilISO: string) { const { error } = await this.db.from('merchant_schedules').insert({ outlet_id: outletId, item_ids: [], off_at: '00:00', on_at: '00:00', active: false, created_by: 'snooze', last_result: { snoozedUntil: untilISO } }); this.check(error) }
  async snoozedUntil(outletId: string) { const rows = await this.list(outletId); const s = rows.filter(r => r.createdBy === 'snooze').map(r => r.snoozedUntil || '').sort().at(-1); return s || null }
}

// ── pure: messages ───────────────────────────────────────────────────────────────
const hourWord = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}` }
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

export function proposalMessage(outletId: string, p: CutoffProposal): MerchantMessage {
  const names = p.items.map(i => `${i.name} ${i.count}`).join(', ')
  const text = `Breakfast items\nYou've had *${p.total} cancellation${p.total === 1 ? '' : 's'} this week* marked out of stock: ${names}, all after 11:30 am.\nShall I turn ${p.items.length === 1 ? 'it' : `these ${p.items.length}`} off at *11:30 every day* and back on at 7 am? You can say "keep pongal on" any time.`
  return { text, buttons: [{ id: `cutoff:${outletId}:daily`, title: 'Yes, every day' }, { id: `cutoff:${outletId}:today`, title: 'Only today' }, { id: `cutoff:${outletId}:no`, title: 'No' }] }
}
export const scheduleSetText = (names: string[], s: Pick<Schedule, 'offAt' | 'onAt'>, firstRunToday: boolean) =>
  `Set: ${list(names)} go off at ${hourWord(s.offAt)} and on at ${hourWord(s.onAt)} daily.${firstRunToday ? ` First run today at ${hourWord(s.offAt)}.` : ''} I'll confirm each change from Tipplr and tell you if one fails.`

export type RunItemResult = { name: string; record: ActionRecord | null; text: string }
/** One message per run: "Done" names only the items Tipplr confirmed; a failed item is named with why. */
export function runReceipt(results: RunItemResult[], off: boolean, onAt: string): string {
  const ok = results.filter(r => r.record?.state === 'verified_success').map(r => r.name)
  const bad = results.filter(r => r.record?.state !== 'verified_success')
  const lines: string[] = []
  if (ok.length) lines.push(`Done\nTurned ${off ? 'off' : 'on'} ${list(ok)} on Tipplr (checked back: ${ok.length === 1 ? 'it shows' : 'all show'} *${off ? 'unavailable' : 'available'}*).${off ? ` Back on at ${hourWord(onAt)}.` : ''}`)
  for (const b of bad) lines.push(`${b.name}: ${b.text}`)
  return lines.join('\n')
}

// ── the flows ────────────────────────────────────────────────────────────────────
const DAY = 86_400_000
const istMinutes = (now: number) => { const d = new Date(now + 5.5 * 3_600_000); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const hhmmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }
const istDayKey = (now: number) => new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10)

/** 11:20 daily: outlets with the breakfast pattern, no active schedule, not snoozed, not POS → the proposal. */
export async function proposeCutoffs(adapter: TipplrAdapter, store: ScheduleStore, now = Date.now(), days = 7): Promise<{ outlet: Outlet; message: MerchantMessage; proposal: CutoffProposal }[]> {
  const out: { outlet: Outlet; message: MerchantMessage; proposal: CutoffProposal }[] = []
  for (const outlet of await adapter.listOutlets()) {
    if (outlet.posIntegrated) continue
    const active = (await store.list(outlet.id)).some(s => s.active)
    const snoozed = await store.snoozedUntil(outlet.id)
    if (active || (snoozed && Date.parse(snoozed) > now)) continue
    const items = await adapter.listItems(outlet.id)
    const history: Order[] = await adapter.listOrders(outlet.id, new Date(now - days * DAY).toISOString())
    const p = cutoffProposal(outlet.id, history, items, now, days)
    if (p) out.push({ outlet, message: proposalMessage(outlet.id, p), proposal: p })
  }
  return out
}

/** Runs the items of a schedule off or on, each through the availability action with read-back. */
async function runItems(adapter: TipplrAdapter, outlet: Outlet, itemIds: string[], off: boolean, untilHour: number | null, persist: Persist, now: number): Promise<RunItemResult[]> {
  const items: MenuItem[] = await adapter.listItems(outlet.id)
  const results: RunItemResult[] = []
  for (const id of itemIds) {
    const item = items.find(i => i.id === id)
    if (!item) { results.push({ name: id, record: null, text: 'no longer on the menu' }); continue }
    const r = await setAvailability(adapter, `schedule:${outlet.id}`, outlet, item.name, !off, off ? untilHour : null, persist, now)
    results.push({ name: item.name, record: r.record, text: r.text })
  }
  return results
}

/** The merchant's answer to the proposal. */
export async function applyCutoffChoice(adapter: TipplrAdapter, store: ScheduleStore, outlet: Outlet, choice: 'daily' | 'today' | 'no', proposal: CutoffProposal, persist: Persist, now = Date.now()): Promise<string> {
  if (choice === 'no') { await store.snooze(outlet.id, new Date(now + 7 * DAY).toISOString()); return "Okay, I'll leave the menu alone and won't bring this up for a week." }
  const names = proposal.items.map(i => i.name)
  if (choice === 'today') {
    const results = await runItems(adapter, outlet, proposal.items.map(i => i.itemId), true, 7 + 24, persist, now) // until 7 am tomorrow
    return runReceipt(results, true, '07:00')
  }
  const s = await store.save({ outletId: outlet.id, itemIds: proposal.items.map(i => i.itemId), offAt: '11:30', onAt: '07:00', active: true, createdBy: `merchant:${outlet.id}` })
  const firstRunToday = istMinutes(now) < hhmmToMin(s.offAt)
  if (!firstRunToday) {
    // Past 11:30 already: do today's run now so the schedule is true from the first message.
    const results = await runItems(adapter, outlet, s.itemIds, true, null, persist, now)
    await store.update(s.id, { lastRunAt: new Date(now).toISOString(), lastResult: { kind: 'off', day: istDayKey(now), ok: results.filter(r => r.record?.state === 'verified_success').length } })
    return `${scheduleSetText(names, s, false)}\n${runReceipt(results, true, s.onAt)}`
  }
  return scheduleSetText(names, s, true)
}

/** Cron: every active schedule whose off/on time has passed today and has not run today → run it. Returns one message per outlet. */
export async function runDueSchedules(adapter: TipplrAdapter, store: ScheduleStore, persist: Persist, now = Date.now()): Promise<{ outlet: Outlet; text: string }[]> {
  const outlets = await adapter.listOutlets()
  const out: { outlet: Outlet; text: string }[] = []
  const minutes = istMinutes(now), day = istDayKey(now)
  for (const s of await store.list()) {
    if (!s.active) continue
    const outlet = outlets.find(o => o.id === s.outletId); if (!outlet) continue
    const last = s.lastResult as any
    const offDue = minutes >= hhmmToMin(s.offAt) && !(last?.day === day && last?.kind === 'off')
    // Back on only after an off run (items are actually off); never "turn on" something that was never turned off.
    const onDue = minutes >= hhmmToMin(s.onAt) && minutes < hhmmToMin(s.offAt) && last?.kind === 'off'
    if (!offDue && !onDue) continue
    const off = offDue
    const results = await runItems(adapter, outlet, s.itemIds, off, null, persist, now)
    await store.update(s.id, { lastRunAt: new Date(now).toISOString(), lastResult: { kind: off ? 'off' : 'on', day, ok: results.filter(r => r.record?.state === 'verified_success').length, failed: results.filter(r => r.record?.state !== 'verified_success').map(r => r.name) } })
    out.push({ outlet, text: runReceipt(results, off, s.onAt) })
  }
  return out
}

/** "keep pongal on" / "add upma to the cut-off" / "stop the cut-off". Returns null when the text is not a schedule edit. */
export async function editSchedule(adapter: TipplrAdapter, store: ScheduleStore, outlet: Outlet, text: string, persist: Persist, now = Date.now()): Promise<string | null> {
  const t = text.trim()
  const schedules = (await store.list(outlet.id)).filter(s => s.active)
  let m: RegExpMatchArray | null
  if (/^(?:stop|cancel|remove)\s+(?:the\s+)?(?:cut-?off|schedule|breakfast schedule)$/i.test(t)) {
    if (!schedules.length) return 'There is no cut-off schedule on this outlet.'
    for (const s of schedules) await store.update(s.id, { active: false })
    return 'Stopped: no more scheduled changes. Items stay as they are now; say "turn <item> back on" if any is off.'
  }
  if ((m = t.match(/^keep\s+(.+?)\s+on$/i))) {
    const name = m[1].trim()
    const items = await adapter.listItems(outlet.id); const item = items.find(i => i.name.toLowerCase() === name.toLowerCase())
    if (!item) return `I don't see "${name}" on the menu.`
    const s = schedules.find(x => x.itemIds.includes(item.id))
    if (!s) return `${item.name} isn't on the cut-off list, so it stays on.`
    await store.update(s.id, { itemIds: s.itemIds.filter(id => id !== item.id) })
    const r = item.available ? null : await setAvailability(adapter, `merchant:${outlet.id}`, outlet, item.name, true, null, persist, now)
    return `${item.name} taken off the cut-off list.${r ? ` ${r.text}` : ''}`
  }
  if ((m = t.match(/^add\s+(.+?)\s+to\s+(?:the\s+)?cut-?off$/i))) {
    const name = m[1].trim()
    const items = await adapter.listItems(outlet.id); const item = items.find(i => i.name.toLowerCase() === name.toLowerCase())
    if (!item) return `I don't see "${name}" on the menu.`
    const s = schedules[0]
    if (!s) return 'There is no cut-off schedule yet. Say "yes, every day" to the breakfast proposal first.'
    if (!s.itemIds.includes(item.id)) await store.update(s.id, { itemIds: [...s.itemIds, item.id] })
    return `${item.name} added: off at ${hourWord(s.offAt)}, on at ${hourWord(s.onAt)}.`
  }
  if (/^(?:what|show)\s+(?:is\s+)?(?:the\s+)?(?:cut-?off|schedule)\??$/i.test(t)) {
    if (!schedules.length) return 'No cut-off schedule on this outlet.'
    const items = await adapter.listItems(outlet.id)
    return schedules.map(s => `Off at ${hourWord(s.offAt)}, on at ${hourWord(s.onAt)}: ${list(s.itemIds.map(id => items.find(i => i.id === id)?.name || id))}.`).join('\n')
  }
  return null
}
