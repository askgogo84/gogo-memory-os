// Phase 4 — invoice draft and approve (screen 3's last card). The draft is built from the ledger only; "approve" files
// it as an order event through an action record. Tipplr has no invoice API in the pilot, so filing means the pilot's
// own ledger; the Tipplr adapter can take it over later without changing the merchant-facing text.
import type { Order, Outlet, TipplrAdapter } from './types'
import { inr } from './types'
import { attachEvidence, openActionRecord, receiptLine, recordVerification, transition, type ActionRecord } from '@/lib/agent/action-record'

export const GST_RATE = 0.05 // restaurant food, non-AC/AC composition: 5% without ITC (verify with Tipplr's accountant before the live pilot)
export type InvoiceDraft = { orderId: string; outletName: string; items: { name: string; qty: number; linePaise: number }[]; subtotalPaise: number; gstPaise: number; totalPaise: number; previewPath: string }

/** The draft. Pure. */
export function draftInvoice(order: Order, outlet: Outlet): InvoiceDraft {
  const items = order.items.map(l => ({ name: l.name, qty: l.qty, linePaise: l.qty * l.pricePaise }))
  const subtotalPaise = items.reduce((s, i) => s + i.linePaise, 0)
  const gstPaise = Math.round(subtotalPaise * GST_RATE)
  return { orderId: order.id, outletName: outlet.name, items, subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise, previewPath: `/e/inv-${encodeURIComponent(order.id)}` }
}

export function invoiceDraftText(d: InvoiceDraft, baseUrl = 'https://app.askgogo.in'): string {
  return `Needs approval\nDraft ready: invoice for #${d.orderId}, ${d.outletName}, ${inr(d.subtotalPaise)} + GST ${Math.round(GST_RATE * 100)}% ${inr(d.gstPaise)} = *${inr(d.totalPaise)}*. I'll only file it if you say "approve".\nPreview: ${baseUrl}${d.previewPath}`
}

export const INVOICE_ASK = /^(?:generate|make|create|raise)\s+(?:an?\s+)?invoice\s+for\s+#?([A-Za-z0-9-]+)$/i

export type InvoiceFiler = (d: InvoiceDraft) => Promise<{ ok: boolean; status: number; ref?: string | null; error?: string }>

/** On "approve": file through the filer (ledger event in the pilot), read it back, receipt. */
export async function fileInvoice(d: InvoiceDraft, file: InvoiceFiler, readBack: (orderId: string) => Promise<boolean>, persist: (r: ActionRecord) => Promise<void>): Promise<string> {
  let rec = transition(openActionRecord({ telegramId: 'ops', capability: 'merchant', action: 'merchant.invoice.file', request: `invoice ${d.orderId}`, policy: { capability: 'merchant', permissionLevel: 'ask', mode: 'execute', risk: 'medium', irreversible: true } }), 'running', { note: 'ops_approve' })
  const r = await file(d)
  rec = attachEvidence(rec, { provider: 'tipplr.invoices', ids: { orderId: d.orderId, ref: String(r.ref || '') }, httpStatus: r.status, note: r.error || null })
  const present = r.ok ? await readBack(d.orderId).catch(() => false) : false
  rec = recordVerification(rec, present ? { state: 'verified_completed', evidence: { ref: r.ref || null, total: d.totalPaise } } : r.ok ? { state: 'still_unknown', evidence: { status: r.status }, reason: 'read_back_missing' } : { state: 'verified_absent', evidence: { status: r.status, error: r.error } })
  await persist(rec)
  return receiptLine(rec, `invoice for #${d.orderId} filed, ${inr(d.totalPaise)}`)
}

/** Pilot filer: an order event in the ledger (merchant_order_events via the adapter's db when available). */
export function ledgerFiler(db: { from: (t: string) => any } | null, memory: InvoiceDraft[] = []) {
  const filed = memory
  const file: InvoiceFiler = async d => {
    if (!db) { filed.push(d); return { ok: true, status: 200, ref: `inv-${d.orderId}` } }
    const { error } = await db.from('merchant_order_events').insert({ order_id: d.orderId, kind: 'invoice', detail: { total_paise: d.totalPaise, gst_paise: d.gstPaise, items: d.items }, actor: 'ops', action_record_id: null })
    return error ? { ok: false, status: 502, error: String(error.message || '').slice(0, 80) } : { ok: true, status: 200, ref: `inv-${d.orderId}` }
  }
  const readBack = async (orderId: string) => {
    if (!db) return filed.some(f => f.orderId === orderId)
    const { data } = await db.from('merchant_order_events').select('id').eq('order_id', orderId).eq('kind', 'invoice').limit(1)
    return Boolean(data?.length)
  }
  return { file, readBack, filed }
}

/** Ops ask → the draft (or why not). */
export async function tryInvoiceAsk(adapter: TipplrAdapter, text: string, baseUrl?: string): Promise<{ text: string; draft: InvoiceDraft | null } | null> {
  const m = text.trim().match(INVOICE_ASK)
  if (!m) return null
  const order = await adapter.getOrder(m[1])
  if (!order) return { text: `I don't have an order #${m[1]} in the pilot ledger.`, draft: null }
  if (order.state === 'cancelled' || order.state === 'rejected' || order.state === 'new') return { text: `#${order.id} is ${order.state}; an invoice is raised only for an accepted or delivered order.`, draft: null }
  const outlet = (await adapter.listOutlets()).find(o => o.id === order.outletId)
  if (!outlet) return { text: `#${order.id} belongs to an outlet I can't see.`, draft: null }
  const draft = draftInvoice(order, outlet)
  return { text: invoiceDraftText(draft, baseUrl), draft }
}
