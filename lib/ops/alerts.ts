// Gogo Ops Alerts (3 Nov 2026, approved mockup). Every operational signal lands in public.ops_alerts, grouped by a
// fingerprint into one incident with a count, so 4,000 identical errors are one line, not 4,000 messages.
// P1 (billing, error spikes, task-failure spikes) goes to the owner's alert WhatsApp at once; P2 arrives in an
// hourly digest. The alert number is the owner's second phone (8310441698), so the daily number stays clean.
// P1 is never muted automatically: only an explicit "mute N" from the alert number does that.
//
// Phase 1 detectors: billing emails in the owner's Gmail, failed metered API calls, failed tasks.
// Until the migration runs, every database call reports the table missing and nothing is sent.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type Severity = 'P1' | 'P2' | 'P3'
export type AlertSource = 'billing' | 'errors' | 'tasks' | 'provider' | 'jobs' | 'security' | 'whatsapp' | 'code' | 'quality'
export type AlertInput = { fingerprint: string; source: AlertSource; severity: Severity; title: string; detail: string; occurrences?: number }
export type OpsAlert = AlertInput & {
  id: string; no: number; occurrences: number; status: 'open' | 'acked' | 'muted' | 'resolved'
  muted_until: string | null; first_seen: string; last_seen: string; notified_at: string | null
}

const clean = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const RANK: Record<Severity, number> = { P1: 3, P2: 2, P3: 1 }
const MIN = 60_000

export const OPS_ALERT_NUMBER_DEFAULT = '+918310441698'
export function opsAlertNumber() {
  return clean(process.env.OPS_ALERT_WHATSAPP_NUMBER || OPS_ALERT_NUMBER_DEFAULT, 40)
}
/** 4 Nov P1 hotfix (#274 review): a phone identity is the complete E.164 number, never a shared national suffix.
 * "+918310441698", "918310441698" and "whatsapp:+918310441698" are one identity; "8310441698" (no country code),
 * "+18310441698" and anything with extra characters are not. Same rule as canonicalAdminPhone. */
export function canonicalE164(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:/i, '').trim()
  const prefixed = raw.startsWith('+')
  const digits = prefixed ? raw.slice(1) : raw
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null
  if (!prefixed && digits.length <= 10) return null
  return '+' + digits
}
/** Privileged Ops commands only from the exact configured alert number. */
export function isOpsAlertNumber(phone: unknown) {
  const sender = canonicalE164(phone), owner = canonicalE164(opsAlertNumber())
  return Boolean(sender && owner && sender === owner)
}

// ------------------------------------------------------------------ detectors (pure)

export type MeterRow = { vendor: string; category: string; failures: number; calls: number }
/** Failed metered API calls. A spike (20+ failures in 15 min, at least half of the calls) is P1; 5+ in an hour is P2. */
export function meterAlerts(last15: MeterRow[], last60: MeterRow[]): AlertInput[] {
  const out: AlertInput[] = []
  const key = (r: MeterRow) => `${clean(r.vendor, 60).toLowerCase()}:${clean(r.category, 60).toLowerCase()}`
  const spikes = new Set<string>()
  for (const r of last15) {
    const failures = Number(r.failures) || 0, calls = Number(r.calls) || 0
    if (failures >= 20 && calls > 0 && failures / calls >= 0.5) {
      spikes.add(key(r))
      out.push({ fingerprint: `errors:spike:${key(r)}`, source: 'errors', severity: 'P1', title: `Error spike · ${clean(r.vendor, 60)} ${clean(r.category, 60)}`, detail: `${failures} of ${calls} calls failed in the last 15 minutes.`, occurrences: failures })
    }
  }
  for (const r of last60) {
    const failures = Number(r.failures) || 0, calls = Number(r.calls) || 0
    if (failures >= 5 && !spikes.has(key(r))) {
      out.push({ fingerprint: `provider:${key(r)}`, source: 'provider', severity: 'P2', title: `${clean(r.vendor, 60)} failing · ${clean(r.category, 60)}`, detail: `${failures} of ${calls} calls failed in the last hour.`, occurrences: failures })
    }
  }
  return out
}

/** Failed tasks (agent_runs). 10+ in 15 minutes is a P1 spike; 5+ in an hour is P2. */
export function taskAlerts(failed15: number, failed60: number): AlertInput[] {
  if (failed15 >= 10) return [{ fingerprint: 'tasks:spike', source: 'tasks', severity: 'P1', title: 'Failed tasks spiking', detail: `${failed15} tasks failed in the last 15 minutes (${failed60} in the hour).`, occurrences: failed15 }]
  if (failed60 >= 5) return [{ fingerprint: 'tasks:hourly', source: 'tasks', severity: 'P2', title: 'Tasks failing', detail: `${failed60} tasks failed in the last hour.`, occurrences: failed60 }]
  return []
}

const BILLING_VENDORS: [RegExp, string][] = [
  [/vercel\.com/i, 'Vercel'], [/supabase\.(?:com|io)/i, 'Supabase'], [/razorpay\.com/i, 'Razorpay'], [/twilio\.com/i, 'Twilio'],
  [/github\.com/i, 'GitHub'], [/groq\.com/i, 'Groq'], [/openai\.com/i, 'OpenAI'], [/anthropic\.com/i, 'Anthropic'],
  [/google\.com/i, 'Google Cloud'], [/composio\.dev/i, 'Composio'], [/serper\.dev/i, 'Serper'], [/godaddy\.com/i, 'GoDaddy'],
  [/resend\.com/i, 'Resend'], [/aerodatabox|rapidapi\.com/i, 'RapidAPI'],
]
const BILLING_PROBLEM = /\b(?:payment\s+(?:failed|declined|unsuccessful|issue)|failed\s+to\s+charge|card\s+(?:was\s+)?declined|past\s+due|overdue|unpaid|suspend(?:ed|ing)?|shut\s*down|service\s+interruption|action\s+required.{0,40}(?:payment|billing)|update\s+your\s+(?:payment|billing|card))\b/i
/** The Gmail query that finds billing problems from the services AskGogo runs on (last 3 days). */
export const BILLING_GMAIL_QUERY = 'newer_than:3d (from:vercel.com OR from:supabase.com OR from:supabase.io OR from:razorpay.com OR from:twilio.com OR from:github.com OR from:groq.com OR from:openai.com OR from:anthropic.com OR from:composio.dev OR from:serper.dev OR from:godaddy.com OR from:resend.com OR from:rapidapi.com) ("payment failed" OR "failed to charge" OR declined OR "past due" OR overdue OR unpaid OR suspended OR shutdown OR "update your payment")'
/** One billing email → one P1 per vendor. Marketing and receipts are ignored. */
export function billingAlert(msg: { from?: string; subject?: string; snippet?: string }): AlertInput | null {
  const from = String(msg?.from || '')
  const vendor = BILLING_VENDORS.find(([re]) => re.test(from))?.[1]
  if (!vendor) return null
  const text = `${msg?.subject || ''} ${msg?.snippet || ''}`
  if (!BILLING_PROBLEM.test(text) || /\b(?:receipt|invoice\s+paid|payment\s+(?:received|successful)|thank\s+you\s+for\s+your\s+payment)\b/i.test(text)) return null
  const card = text.match(/card\s+ending\s+(?:with\s+|in\s+)?(\d{4})/i)?.[1]
  return { fingerprint: `billing:${vendor.toLowerCase()}`, source: 'billing', severity: 'P1', title: `${vendor} payment failing${card ? ` · card ${card}` : ''}`, detail: clean(msg?.subject, 200) || 'Billing problem email received.' }
}

// ------------------------------------------------------------------ messages (pure)

const ICON: Record<Severity, string> = { P1: '🔴', P2: '🟡', P3: '🔵' }
export function formatP1(a: Pick<OpsAlert, 'no' | 'title' | 'detail' | 'occurrences' | 'source'>, reminder = false) {
  const fix = a.source === 'billing' ? '\n\nOnly you can fix billing; Gogo never changes it.' : ''
  return `${ICON.P1} *P1 · ${clean(a.title, 120)}*${reminder ? ' (still open)' : ''}\n${clean(a.detail, 400)}${a.occurrences > 1 ? `\nSeen ${a.occurrences} times.` : ''}${fix}\n\nReply *ack ${a.no}* when it's handled, or *details ${a.no}*.`
}
/** The same alert as one line, for the WhatsApp template when no chat is open (templates take one short field). */
export function formatP1Line(a: Pick<OpsAlert, 'no' | 'title' | 'detail'>) {
  return clean(`P1 alert #${a.no}: ${a.title}. ${a.detail} Reply ack ${a.no} when handled.`, 380)
}
export function formatDigest(list: Pick<OpsAlert, 'no' | 'title' | 'occurrences' | 'severity'>[]) {
  const top = list.slice(0, 6)
  const lines = top.map(a => `${a.no}. ${clean(a.title, 90)}${a.occurrences > 1 ? ` · ${a.occurrences}×` : ''}`)
  return `${ICON.P2} *Ops digest · ${list.length} open*\n\n${lines.join('\n')}${list.length > top.length ? `\n…and ${list.length - top.length} more` : ''}\n\nReply *details N*, *ack N* or *mute N for 1d*.`
}

// ------------------------------------------------------------------ commands (pure parse)

export type OpsCommand = { kind: 'list' } | { kind: 'ack'; no: number } | { kind: 'details'; no: number } | { kind: 'mute'; no: number; minutes: number }
export function parseOpsCommand(text: string): OpsCommand | null {
  const t = clean(text, 80).toLowerCase().replace(/[.!?]+$/, '')
  if (/^(?:alerts|ops|ops alerts|open alerts)$/.test(t)) return { kind: 'list' }
  let m = t.match(/^(?:ack|acknowledge|done|resolved?)\s+#?(\d{1,6})$/)
  if (m) return { kind: 'ack', no: Number(m[1]) }
  m = t.match(/^(?:details|show|detail)\s+#?(\d{1,6})$/)
  if (m) return { kind: 'details', no: Number(m[1]) }
  m = t.match(/^mute\s+#?(\d{1,6})(?:\s+for\s+(\d{1,3})\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?))?$/)
  if (m) {
    const n = Number(m[2] || 1), unit = String(m[3] || 'd')
    const minutes = /^m/.test(unit) ? n : /^h/.test(unit) ? n * 60 : n * 1440
    return { kind: 'mute', no: Number(m[1]), minutes: Math.min(Math.max(minutes, 5), 14 * 1440) }
  }
  return null
}

// ------------------------------------------------------------------ storage

const MISSING = /relation .*ops_alerts.* does not exist|could not find the table|ops_alerts/i
function tableMissing(error: any) { return Boolean(error) && MISSING.test(String(error?.message || '')) && /exist|find/i.test(String(error?.message || '')) }

/** Record what the detectors saw: one live incident per fingerprint, counts added, severity only ever raised. */
export async function raiseAlerts(inputs: AlertInput[], now = new Date()): Promise<{ ok: boolean; reason?: string; raised: OpsAlert[] }> {
  const raised: OpsAlert[] = []
  for (const input of inputs) {
    const { data: live, error } = await supabaseAdmin.from('ops_alerts').select('*').eq('fingerprint', input.fingerprint).neq('status', 'resolved').maybeSingle()
    if (error) return { ok: false, reason: tableMissing(error) ? 'ops_alerts_table_missing' : `ops_alerts_read_failed:${clean(error.message, 80)}`, raised }
    const iso = now.toISOString()
    if (live) {
      const severity = RANK[input.severity] > RANK[live.severity as Severity] ? input.severity : live.severity
      // occurrences = new events since the last check; 0 means "still over the threshold, nothing new".
      const add = Math.max(0, Math.floor(Number(input.occurrences ?? 1)) || 0)
      const { data, error: upErr } = await supabaseAdmin.from('ops_alerts').update({
        severity, title: clean(input.title), detail: clean(input.detail, 2000), last_seen: add > 0 ? iso : live.last_seen, updated_at: iso,
        occurrences: Math.min(2_000_000_000, Number(live.occurrences || 1) + add),
      }).eq('id', live.id).select('*').single()
      if (upErr) return { ok: false, reason: `ops_alerts_update_failed:${clean(upErr.message, 80)}`, raised }
      raised.push(data as OpsAlert)
    } else {
      const { data, error: insErr } = await supabaseAdmin.from('ops_alerts').insert({
        fingerprint: input.fingerprint, source: input.source, severity: input.severity, title: clean(input.title), detail: clean(input.detail, 2000),
        occurrences: Math.max(1, Number(input.occurrences || 1)), first_seen: iso, last_seen: iso,
      }).select('*').single()
      if (insErr) return { ok: false, reason: tableMissing(insErr) ? 'ops_alerts_table_missing' : `ops_alerts_insert_failed:${clean(insErr.message, 80)}`, raised }
      raised.push(data as OpsAlert)
    }
  }
  return { ok: true, raised }
}

/** An incident whose signal has gone quiet closes itself: 2 hours for errors and tasks, 3 days for billing. */
export async function resolveQuiet(stillFiring: Set<string>, now = new Date()) {
  const { data, error } = await supabaseAdmin.from('ops_alerts').select('id,fingerprint,source,last_seen').neq('status', 'resolved').limit(500)
  if (error) return 0
  let n = 0
  for (const a of data || []) {
    if (stillFiring.has(a.fingerprint)) continue
    const quietFor = now.getTime() - Date.parse(a.last_seen)
    const needed = a.source === 'billing' ? 3 * 1440 * MIN : 120 * MIN
    if (quietFor < needed) continue
    const { error: e } = await supabaseAdmin.from('ops_alerts').update({ status: 'resolved', resolved_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', a.id).neq('status', 'resolved')
    if (!e) n++
  }
  return n
}

export function shouldNotifyP1(a: Pick<OpsAlert, 'severity' | 'status' | 'muted_until' | 'notified_at'>, now = new Date()) {
  if (a.severity !== 'P1' || a.status === 'resolved' || a.status === 'acked') return false
  if (a.muted_until && Date.parse(a.muted_until) > now.getTime()) return false
  if (!a.notified_at) return true
  return now.getTime() - Date.parse(a.notified_at) >= 6 * 60 * MIN // an unacknowledged P1 is repeated every 6 hours
}
export function shouldSendDigest(open: Pick<OpsAlert, 'severity' | 'status' | 'muted_until' | 'notified_at' | 'last_seen'>[], lastDigestAt: string | null, now = new Date()) {
  if (lastDigestAt && now.getTime() - Date.parse(lastDigestAt) < 55 * MIN) return false
  return open.some(a => a.severity === 'P2' && (a.status === 'open' || a.status === 'muted') && !(a.muted_until && Date.parse(a.muted_until) > now.getTime())
    && (!a.notified_at || Date.parse(a.notified_at) < Date.parse(a.last_seen)))
}

/** P2 incidents that may appear in a digest: open, or muted with the mute expired. Acked and actively muted ones are
 * left out of the body, the template line and the digest cursor (4 Nov P2 review). */
export function digestEligible<T extends Pick<OpsAlert, 'severity' | 'status' | 'muted_until'>>(open: T[], now = new Date()): T[] {
  return open.filter(a => a.severity === 'P2' && (a.status === 'open' || (a.status === 'muted' && !(a.muted_until && Date.parse(a.muted_until) > now.getTime()))))
}

export async function openAlerts(): Promise<OpsAlert[] | null> {
  const { data, error } = await supabaseAdmin.from('ops_alerts').select('*').in('status', ['open', 'muted', 'acked']).order('last_seen', { ascending: false }).limit(50)
  return error ? null : (data as OpsAlert[])
}

export async function runOpsCommand(cmd: OpsCommand, now = new Date()): Promise<string> {
  if (cmd.kind === 'list') {
    const list = await openAlerts()
    if (!list) return 'Ops alerts are not switched on yet.'
    const live = list.filter(a => a.status !== 'acked')
    if (!live.length) return '✅ No open alerts.'
    return live.slice(0, 10).map(a => `${ICON[a.severity]} ${a.no}. ${clean(a.title, 90)}${a.occurrences > 1 ? ` · ${a.occurrences}×` : ''}${a.status === 'muted' ? ' · muted' : ''}`).join('\n') + '\n\nReply *details N*, *ack N* or *mute N for 1d*.'
  }
  const { data: a, error } = await supabaseAdmin.from('ops_alerts').select('*').eq('no', cmd.no).maybeSingle()
  if (error) return tableMissing(error) ? 'Ops alerts are not switched on yet.' : "I couldn't read the alerts just now. Nothing was changed."
  if (!a) return `There's no alert ${cmd.no}. Say *alerts* to see the open ones.`
  if (cmd.kind === 'details') {
    return `${ICON[a.severity as Severity]} *${a.no}. ${clean(a.title, 120)}* · ${a.severity} · ${a.status}\n${clean(a.detail, 600)}\nSeen ${a.occurrences}× · first ${new Date(a.first_seen).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · last ${new Date(a.last_seen).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
  }
  const iso = now.toISOString()
  if (cmd.kind === 'ack') {
    if (a.status === 'resolved') return `Alert ${a.no} is already closed.`
    const { error: e } = await supabaseAdmin.from('ops_alerts').update({ status: 'acked', acked_at: iso, updated_at: iso }).eq('id', a.id)
    return e ? "I couldn't update that alert. Nothing was changed." : `✅ Alert ${a.no} acknowledged. It closes itself once the signal stops.`
  }
  const until = new Date(now.getTime() + cmd.minutes * MIN)
  const { error: e } = await supabaseAdmin.from('ops_alerts').update({ status: 'muted', muted_until: until.toISOString(), updated_at: iso }).eq('id', a.id)
  return e ? "I couldn't update that alert. Nothing was changed." : `🔕 Alert ${a.no} muted until ${until.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
}
