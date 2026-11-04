// One ops-alerts pass (every 5 minutes): read the signals, record incidents, close quiet ones, then tell the owner —
// P1 at once, P2 at most hourly. Read-only towards every provider; the only writes are to ops_alerts and the alert
// messages sent to the owner's alert number.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate } from '@/lib/whatsapp'
import {
  BILLING_GMAIL_QUERY, billingAlert, digestEligible, formatDigest, formatP1, formatP1Line, meterAlerts, openAlerts, opsAlertNumber,
  raiseAlerts, resolveQuiet, shouldNotifyP1, shouldSendDigest, taskAlerts, type AlertInput, type MeterRow,
} from './alerts'

const MIN = 60_000

async function meterRows(since: Date): Promise<MeterRow[]> {
  const { data, error } = await supabaseAdmin.rpc('admin_meter_failures', { p_since: since.toISOString() })
  if (error) throw new Error(`meter_failures_read_failed:${error.message}`)
  return (data || []).map((r: any) => ({ vendor: String(r.vendor || ''), category: String(r.category || ''), failures: Number(r.failures || 0), calls: Number(r.calls || 0) }))
}
/** Failed tasks by when they FAILED (4 Nov P2 review), not when they started: a run that began yesterday and failed
 * three minutes ago counts now; an old failure touched later for bookkeeping does not. The terminal time is
 * completed_at; failure writes that never set it fall back to updated_at. A read error is raised, never zero. */
async function failedTasks(since: Date) {
  const iso = since.toISOString()
  const [ended, unstamped] = await Promise.all([
    supabaseAdmin.from('agent_runs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('completed_at', iso),
    supabaseAdmin.from('agent_runs').select('id', { count: 'exact', head: true }).eq('status', 'failed').is('completed_at', null).gte('updated_at', iso),
  ])
  const error = ended.error || unstamped.error
  if (error) throw new Error(`failed_tasks_read_failed:${error.message}`)
  return Number(ended.count || 0) + Number(unstamped.count || 0)
}

/** The ONE owner resolver for privileged Ops paths (inbound commands, billing Gmail, alert recipient). 4 Nov P1
 * hotfix: exact full E.164 only, never a 10-digit suffix. A number without a country code is refused before any read;
 * the stored forms "+91…", "91…" and "whatsapp:+91…" are matched exactly; two different owners for one number, or an
 * owner id that isn't an exact decimal string or safe integer, fail closed. Self-contained on purpose. */
async function userByPhone(phone: string): Promise<{ telegram_id: string } | null> {
  const raw = String(phone ?? '').trim().replace(/^whatsapp:/i, '').trim()
  const prefixed = raw.startsWith('+')
  const digits = prefixed ? raw.slice(1) : raw
  if (!/^[1-9][0-9]{7,14}$/.test(digits) || (!prefixed && digits.length <= 10)) return null
  const forms = [`whatsapp:+${digits}`, `+${digits}`, digits]
  const owners = new Set<string>()
  for (const form of forms) {
    const { data, error } = await supabaseAdmin.from('users').select('telegram_id,whatsapp_id').eq('whatsapp_id', form).limit(3)
    if (error) return null
    for (const u of (data || []) as any[]) {
      const id = u?.telegram_id
      const exact = typeof id === 'string' ? /^-?(?:0|[1-9]\d{0,18})$/.test(id) : typeof id === 'number' && Number.isSafeInteger(id)
      if (!exact) return null
      owners.add(String(id))
    }
  }
  return owners.size === 1 ? { telegram_id: [...owners][0] } : null
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

/** Atomic notification claim: set notified_at only where it still holds the value this pass saw. 'claimed' when
 * this pass won at least one row, 'taken' when another pass already did, 'error' when the write failed. */
async function claimNotification(rows: { id: string }[], now: Date, cond: { eq?: string; isNull?: true; olderThan?: string }): Promise<'claimed' | 'taken' | 'error'> {
  const ids = rows.map(r => r.id)
  if (!ids.length) return 'taken'
  let q: any = supabaseAdmin.from('ops_alerts').update({ notified_at: now.toISOString() }).in('id', ids)
  if (cond.eq) q = q.eq('notified_at', cond.eq)
  else if (cond.isNull) q = q.is('notified_at', null)
  else if (cond.olderThan) q = q.or(`notified_at.is.null,notified_at.lt.${cond.olderThan}`)
  const { data, error } = await q.select('id')
  if (error) return 'error'
  return (data || []).length ? 'claimed' : 'taken'
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
  // 4 Nov P1 hotfix: each notification is CLAIMED in the database before it is sent — a compare-and-swap on the
  // notified_at value this pass read — so two overlapping cron passes can never both send, and a failed claim sends
  // nothing. The claim stands even when the send outcome is unknown (timeout, provider error): it is never retried
  // blind on the next pass; the P1 repeat (6 h) or the next digest is the only resend.
  for (const a of open.filter(x => shouldNotifyP1(x, now)).slice(0, 3)) {
    const claim = await claimNotification([a], now, a.notified_at ? { eq: a.notified_at } : { isNull: true })
    if (claim === 'error') { errors.push('p1_claim_failed'); continue }
    if (claim === 'taken') continue
    try {
      await sendToOps(formatP1(a, Boolean(a.notified_at)), formatP1Line(a))
      sent++
    } catch (e: any) { errors.push(`p1_send_outcome_unknown:${String(e?.message || e).slice(0, 80)}`) }
  }
  const p2 = digestEligible(open, now)
  const lastDigest = p2.map(a => a.notified_at).filter(Boolean).sort().pop() || null
  if (shouldSendDigest(p2, lastDigest, now)) {
    const claim = await claimNotification(p2, now, { olderThan: new Date(now.getTime() - 55 * MIN).toISOString() })
    if (claim === 'error') errors.push('digest_claim_failed')
    else if (claim === 'claimed') {
      try {
        await sendToOps(formatDigest(p2), `Ops digest: ${p2.length} open. ${p2.slice(0, 3).map(a => `${a.no}. ${a.title}`).join('; ')}. Reply alerts for the list.`)
        sent++
      } catch (e: any) { errors.push(`digest_send_outcome_unknown:${String(e?.message || e).slice(0, 80)}`) }
    }
  }
  return { ...result, signals: signals.length, open: open.length, sent, errors }
}
