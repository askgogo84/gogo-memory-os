// Read models for the admin console. Every query is bounded and tolerant of a missing table
// (before the migration is applied the console still renders, with empty sections).
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DAY = 86_400_000
export function istMonthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600_000)
}
export function istDayStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000)
}
export function istDateKey(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000)
  return d.toISOString().slice(0, 10)
}

async function rows<T = any>(q: PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  try { const { data, error } = await q; if (error) { console.error('ADMIN_CONSOLE_QUERY', error.code, error.message); return [] } return (data || []) as T[] } catch { return [] }
}

export type WaitRow = { id: string; phone_e164: string; email: string | null; country: string | null; whatsapp_opt_in: boolean; source: string | null; created_at: string; status: string; approved_at: string | null; invite_status: string | null; profile_name: string | null }
export async function waitlistRows(): Promise<WaitRow[]> {
  const full = await paged<WaitRow>((a, b) => supabaseAdmin.from('waitlist').select('id, phone_e164, email, country, whatsapp_opt_in, source, created_at, status, approved_at, invite_status, profile_name').order('created_at', { ascending: false }).range(a, b))
  if (full.length) return full
  // Before the migration: no status columns yet.
  const legacy = await paged<any>((a, b) => supabaseAdmin.from('waitlist').select('id, phone_e164, email, country, whatsapp_opt_in, source, created_at, invited_at').order('created_at', { ascending: false }).range(a, b))
  return legacy.map(r => ({ ...r, status: r.invited_at ? 'invited' : 'waiting', approved_at: r.invited_at, invite_status: null, profile_name: null }))
}

export type UserRow = { telegram_id: string; name: string; whatsapp_id: string; tier: string; created_at: string | null; access_status: string; gmail_connected?: boolean }
export async function userRows(): Promise<UserRow[]> {
  const data = await paged<any>((a, b) => supabaseAdmin.from('users').select('*').order('created_at', { ascending: false }).range(a, b))
  return data.map(u => ({ telegram_id: String(u.telegram_id), name: u.name || 'Friend', whatsapp_id: String(u.whatsapp_id || '').replace(/^whatsapp:/, ''), tier: u.tier || 'free', created_at: u.created_at || null, access_status: u.access_status || 'active', gmail_connected: !!u.gmail_connected }))
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  try { const { data, error } = await supabaseAdmin.rpc(fn, args); if (error) { console.error('ADMIN_CONSOLE_RPC', fn, error.code); return [] } return (data || []) as T[] } catch { return [] }
}
/** Page through a query 1000 rows at a time (PostgREST caps a response at 1000 rows). */
async function paged<T = any>(make: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, max = 10000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const page = await rows<T>(make(from, from + 999))
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

export const costByUser = async (since: Date) => (await rpc<any>('admin_cost_by_user', { p_since: since.toISOString() })).map(r => ({ telegram_id: String(r.telegram_id), cost: Number(r.cost_inr || 0), events: Number(r.events || 0), last: r.last_at as string }))
export const costByVendor = async (since: Date, telegramId?: string) => (await rpc<any>('admin_cost_by_vendor', { p_since: since.toISOString(), p_telegram_id: telegramId || null })).map(r => ({ vendor: r.vendor as string, category: r.category as string, cost: Number(r.cost_inr || 0), events: Number(r.events || 0), input: Number(r.input_tokens || 0), output: Number(r.output_tokens || 0) }))
export const costByDay = async (since: Date, telegramId?: string) => (await rpc<any>('admin_cost_by_day', { p_since: since.toISOString(), p_telegram_id: telegramId || null })).map(r => ({ day: String(r.day), cost: Number(r.cost_inr || 0), events: Number(r.events || 0) }))
export async function messageCounts(since: Date): Promise<Map<string, { n: number; last: string }>> {
  const m = new Map<string, { n: number; last: string }>()
  for (const r of await rpc<any>('admin_message_counts', { p_since: since.toISOString() })) m.set(String(r.telegram_id), { n: Number(r.messages || 0), last: r.last_at })
  return m
}
export const meterFailures = async (since: Date) => (await rpc<any>('admin_meter_failures', { p_since: since.toISOString() })).map(r => ({ vendor: r.vendor as string, category: r.category as string, failures: Number(r.failures || 0), calls: Number(r.calls || 0), last: r.last_failure as string | null }))
export const runCounts = async (since: Date) => (await rpc<any>('admin_run_counts', { p_since: since.toISOString() })).map(r => ({ telegram_id: String(r.telegram_id), type: r.type as string, status: r.status as string, runs: Number(r.runs || 0) }))

export type RunRow = { id: string; telegram_id: string; type: string; capability: string; status: string; title: string; summary: string; started_at: string; updated_at: string; completed_at: string | null; error: string | null }
export async function runRows(since: Date, telegramId?: string, limit = 200): Promise<RunRow[]> {
  let q = supabaseAdmin.from('agent_runs').select('id, telegram_id, type, capability, status, title, summary, started_at, updated_at, completed_at, error').gte('started_at', since.toISOString()).order('started_at', { ascending: false }).limit(Math.min(limit, 1000))
  if (telegramId) q = q.eq('telegram_id', telegramId)
  return rows<RunRow>(q)
}

export async function payments(since: Date): Promise<{ telegram_id: string | null; amount: number; plan: string; created_at: string }[]> {
  const data = await rows<any>(supabaseAdmin.from('payment_records').select('telegram_id, amount, plan, status, created_at').eq('status', 'paid').gte('created_at', since.toISOString()).limit(5000))
  return data.map(p => ({ telegram_id: p.telegram_id == null ? null : String(p.telegram_id), amount: Number(p.amount || 0) / 100, plan: p.plan, created_at: p.created_at }))
}

export async function toolsWithCosts(month: Date) {
  const tools = await rows<any>(supabaseAdmin.from('admin_tools').select('*').order('sort'))
  const prev = new Date(month.getTime() - 15 * DAY); const prevMonth = istMonthStart(prev)
  const monthKey = istDateKey(new Date(month.getTime() + DAY)).slice(0, 7) + '-01'
  const prevKey = istDateKey(new Date(prevMonth.getTime() + DAY)).slice(0, 7) + '-01'
  const costs = await rows<any>(supabaseAdmin.from('admin_tool_costs').select('tool_id, month, amount_inr, source, note, created_at').in('month', [monthKey, prevKey]))
  const meteredNow = await costByVendor(month)
  const meteredBoth = await costByVendor(prevMonth)
  return { tools, costs, meteredNow, meteredBoth, monthKey, prevKey, monthStart: month, prevStart: prevMonth }
}

export async function auditRows(limit = 200) {
  return rows<any>(supabaseAdmin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit))
}
export async function adminMembers() {
  return rows<any>(supabaseAdmin.from('admin_members').select('*').order('created_at'))
}
export async function rateCard() {
  return rows<any>(supabaseAdmin.from('admin_rate_card').select('*').order('key'))
}
export async function cronHeartbeats() {
  return rows<any>(supabaseAdmin.from('cron_heartbeats').select('*'))
}

export function cronJobs(): { path: string; schedule: string; job: string }[] {
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
    return (cfg.crons || []).map((c: any) => ({ path: c.path, schedule: c.schedule, job: String(c.path).split('/').pop() }))
  } catch { return [] }
}

export const inr = (n: number, digits = 0) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
export const inrSmart = (n: number) => inr(n, Math.abs(n) < 100 ? 2 : 0)
export function maskPhone(p: string) {
  const s = String(p || '').replace(/^whatsapp:/, '')
  if (s.length < 8) return s
  return s.slice(0, s.startsWith('+971') ? 7 : 9) + ' •• ' + s.slice(-3)
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min ago`
  if (ms < DAY) return `${Math.round(ms / 3600_000)} h ago`
  if (ms < 7 * DAY) return `${Math.round(ms / DAY)} days ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
}
export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}
export const PLAN_BUDGET_INR: Record<string, number> = { free: 25, imported: 25, essential: 120, lite: 120, plus: 240, starter: 240, pro: 480, pro_annual: 480, founder_pro: 5000 }
export const PLAN_LABEL: Record<string, string> = { free: 'Free', starter: 'Starter', plus: 'Plus', lite: 'Lite', essential: 'Essential', pro: 'Pro', pro_annual: 'Pro annual', founder_pro: 'Founder Pro', imported: 'Imported' }
export const VENDOR_LABEL: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI', inception: 'Mercury', tavily: 'Tavily', serper: 'Serper', bolna: 'Phone calls (Bolna)', browserbase: 'Secure browser', assemblyai: 'AssemblyAI', twilio: 'WhatsApp messages', resend: 'Email' }
export const CATEGORY_GROUP = (vendor: string) => ['anthropic', 'openai', 'inception', 'assemblyai'].includes(vendor) ? 'AI models' : ['tavily', 'serper'].includes(vendor) ? 'Web search' : vendor === 'bolna' ? 'Phone calls' : vendor === 'browserbase' ? 'Secure browser' : vendor === 'twilio' ? 'WhatsApp messages' : 'Other'
