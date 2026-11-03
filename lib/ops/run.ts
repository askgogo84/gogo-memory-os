// One ops-alerts pass (every 5 minutes): read the signals, record incidents, close quiet ones, then tell the owner —
// P1 at once, P2 at most hourly. Read-only towards every provider; the only writes are to ops_alerts and the alert
// messages sent to the owner's alert number.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate } from '@/lib/whatsapp'
import {
  BILLING_GMAIL_QUERY, billingAlert, formatDigest, formatP1, formatP1Line, meterAlerts, openAlerts, opsAlertNumber,
  raiseAlerts, resolveQuiet, shouldNotifyP1, shouldSendDigest, taskAlerts, type AlertInput, type MeterRow,
} from './alerts'

const MIN = 60_000
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)

async function meterRows(since: Date): Promise<MeterRow[]> {
  const { data, error } = await supabaseAdmin.rpc('admin_meter_failures', { p_since: since.toISOString() })
  if (error) throw new Error(`meter_failures_read_failed:${error.message}`)
  return (data || []).map((r: any) => ({ vendor: String(r.vendor || ''), category: String(r.category || ''), failures: Number(r.failures || 0), calls: Number(r.calls || 0) }))
}
async function failedTasks(since: Date) {
  const { count, error } = await supabaseAdmin.from('agent_runs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('started_at', since.toISOString())
  if (error) throw new Error(`failed_tasks_read_failed:${error.message}`)
  return Number(count || 0)
}

/** The user row behind a phone number (stored as +91…, 91… or whatsapp:+91…), exact on the last 10 digits. */
async function userByPhone(phone: string): Promise<{ telegram_id: string } | null> {
  const ten = last10(phone)
  if (ten.length !== 10) return null
  const { data } = await supabaseAdmin.from('users').select('telegram_id,whatsapp_id').ilike('whatsapp_id', `%${ten}`).limit(5)
  const row = (data || []).find((u: any) => last10(u.whatsapp_id) === ten)
  return row ? { telegram_id: String(row.telegram_id) } : null
}

/** Billing problems in the owner's connected Gmail (the admin numbers' accounts). Metadata only, newest first. */
async function billingSignals(): Promise<AlertInput[]> {
  const owners = String(process.env.ADMIN_WHATSAPP_NUMBERS || process.env.ADMIN_WHATSAPP_NUMBER || '').split(',').map(s => s.trim()).filter(Boolean)
  const { resolveAgentActor } = await import('@/lib/agent/actor')
  const { searchWorkspaceEmailsByQuery } = await import('@/lib/agent/google-workspace-read')
  const out: AlertInput[] = []
  for (const phone of owners) {
    const user = await userByPhone(phone)
    if (!user) continue
    try {
      const actor = await resolveAgentActor({ telegramId: user.telegram_id, surface: 'web' })
      const messages: any[] = await searchWorkspaceEmailsByQuery(actor, BILLING_GMAIL_QUERY, 10)
      for (const m of messages) {
        const a = billingAlert(m)
        if (a && !out.some(x => x.fingerprint === a.fingerprint)) out.push({ ...a, occurrences: 1, emailDate: m.date } as AlertInput & { emailDate?: string })
      }
      return out
    } catch (err: any) {
      console.error('OPS_BILLING_READ_FAILED:', String(err?.message || err).slice(0, 120))
    }
  }
  return out
}

/** Free text inside an open WhatsApp chat; otherwise the approved template (one short line). */
async function sendToOps(text: string, line: string) {
  const to = opsAlertNumber()
  const owner = await userByPhone(to)
  let active = false
  if (owner) {
    const { data } = await supabaseAdmin.from('conversations').select('id').eq('telegram_id', owner.telegram_id).eq('role', 'user')
      .gte('created_at', new Date(Date.now() - 23 * 60 * MIN).toISOString()).limit(1)
    active = Boolean(data?.length)
  }
  if (active) await sendWhatsApp(to, text)
  else await sendWhatsAppReminderTemplate(to, line)
  return active ? 'freeform' : 'template'
}

export async function runOpsAlertsPass(now = new Date()) {
  const result: Record<string, unknown> = { ok: true }
  const signals: AlertInput[] = []
  const errors: string[] = []
  try {
    const [m5, m15, m60] = await Promise.all([5, 15, 60].map(n => meterRows(new Date(now.getTime() - n * MIN))))
    const recent = new Map(m5.map(r => [`${r.vendor.toLowerCase()}:${r.category.toLowerCase()}`, r.failures]))
    for (const a of meterAlerts(m15, m60)) signals.push({ ...a, occurrences: recent.get(a.fingerprint.split(':').slice(-2).join(':')) || 0 })
  } catch (e: any) { errors.push(String(e?.message || e).slice(0, 120)) }
  try {
    const [f5, f15, f60] = await Promise.all([5, 15, 60].map(n => failedTasks(new Date(now.getTime() - n * MIN))))
    for (const a of taskAlerts(f15, f60)) signals.push({ ...a, occurrences: f5 })
  } catch (e: any) { errors.push(String(e?.message || e).slice(0, 120)) }

  // Gmail is read every 30 minutes, not every pass. A billing email raises its incident once; later passes only
  // keep it live (no new count) until the email ages out of the 3-day search.
  const billingTurn = now.getUTCMinutes() % 30 < 5
  const firing = new Set(signals.map(s => s.fingerprint))
  if (billingTurn) {
    const billing = await billingSignals().catch(() => [] as AlertInput[])
    const live = await openAlerts()
    for (const b of billing as (AlertInput & { emailDate?: string })[]) {
      firing.add(b.fingerprint)
      const existing = live?.find(a => a.fingerprint === b.fingerprint)
      const newer = !existing || (Date.parse(String(b.emailDate || '')) || 0) > Date.parse(existing.last_seen)
      signals.push({ fingerprint: b.fingerprint, source: b.source, severity: b.severity, title: b.title, detail: b.detail, occurrences: newer ? 1 : 0 })
    }
  } else {
    for (const a of (await openAlerts()) || []) if (a.source === 'billing') firing.add(a.fingerprint)
  }

  const raised = await raiseAlerts(signals, now)
  if (!raised.ok) return { ok: false, reason: raised.reason, errors }
  result.resolved = await resolveQuiet(firing, now)

  const open = (await openAlerts()) || []
  let sent = 0
  for (const a of open.filter(x => shouldNotifyP1(x, now)).slice(0, 3)) {
    try {
      await sendToOps(formatP1(a, Boolean(a.notified_at)), formatP1Line(a))
      await supabaseAdmin.from('ops_alerts').update({ notified_at: now.toISOString() }).eq('id', a.id)
      sent++
    } catch (e: any) { errors.push(`p1_send_failed:${String(e?.message || e).slice(0, 80)}`) }
  }
  const p2 = open.filter(a => a.severity === 'P2' && a.status !== 'acked')
  const lastDigest = p2.map(a => a.notified_at).filter(Boolean).sort().pop() || null
  if (shouldSendDigest(p2, lastDigest, now)) {
    try {
      await sendToOps(formatDigest(p2), `Ops digest: ${p2.length} open. ${p2.slice(0, 3).map(a => `${a.no}. ${a.title}`).join('; ')}. Reply alerts for the list.`)
      await supabaseAdmin.from('ops_alerts').update({ notified_at: now.toISOString() }).in('id', p2.map(a => a.id))
      sent++
    } catch (e: any) { errors.push(`digest_send_failed:${String(e?.message || e).slice(0, 80)}`) }
  }
  return { ...result, signals: signals.length, open: open.length, sent, errors }
}
