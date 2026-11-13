// Model email judge, SHADOW ONLY (13 Nov, owner-approved). For GOGO_PROACTIVE_SHADOW owners, every 30 minutes: the
// last 48 hours of inbound mail from all their connected mailboxes is judged once per email, and what Gogo WOULD send
// is logged as agent_activity proactive_shadow kind 'email_judge'. Nothing is sent, saved as a task or marked shown.
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchGmailThreads, refreshGmailAccessToken } from '@/lib/services/google-gmail'
import { HAIKU_MODEL } from '@/lib/services/model-ids'
import { judgeEmails, JUDGE_MAX_EMAILS, JUDGE_PER_DAY, type JudgeEmail, type JudgeVerdict } from '@/lib/email/judge'
import { shadowText, logProactiveShadow, recentShadowRows } from './proactive-shadow'
import { getAlertPreferences, isQuietHour } from './alert-preferences'

const INBOX_QUERY = 'in:inbox newer_than:2d -category:promotions -category:social -category:forums'
const MAX_AGE_MS = 48 * 3600_000

function addr(from: string) { return (String(from || '').match(/<([^>]+)>/)?.[1] || String(from || '')).trim().toLowerCase() }
function ownerKey(id: string): number | string { const n = Number(id); return Number.isSafeInteger(n) && String(n) === id ? n : id }
function localHour(tz: string, now: number) { try { return Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(now))) } catch { return NaN } }
function localDay(iso: string | number, tz: string) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) } catch { return '' } }

type Mailbox = { email: string; accessToken: string }
type Deps = {
  mailboxes?: (telegramId: string) => Promise<Mailbox[]>
  search?: (accessToken: string) => Promise<any[]>
  create?: (req: any) => Promise<any>
  history?: (telegramId: string) => Promise<{ at: string; meta: any }[] | null>
  log?: (telegramId: string, meta: Record<string, unknown>) => Promise<boolean>
  user?: (telegramId: string) => Promise<any>
  quiet?: (telegramId: string, tz: string) => Promise<boolean>
  now?: () => number
}

/** The person's own connected mailboxes (primary + extra), read access only. */
async function ownerMailboxes(telegramId: string): Promise<Mailbox[]> {
  const out: Mailbox[] = []
  const { gmailAccessForOwner } = await import('./open-loops')
  const primary = await gmailAccessForOwner(telegramId).catch(() => null)
  if (primary && !('reason' in primary)) out.push({ email: primary.ownEmail, accessToken: primary.accessToken })
  // Extra mailboxes count only while the primary Gmail consent holds (the person's yes to Gogo reading mail).
  if (!out.length) return out
  const { listExtraGmailAccounts } = await import('./gmail-accounts')
  for (const a of await listExtraGmailAccounts(telegramId).catch(() => [])) {
    if (a.email === out[0].email) continue
    const token = a.refreshToken ? String(await refreshGmailAccessToken(a.refreshToken).catch(() => '') || '') : a.accessToken
    // A failed refresh is reported as an unread mailbox, never silently dropped (and never the stale stored token).
    out.push({ email: a.email, accessToken: token })
  }
  return out
}

/** Inbound, recent, not from the person's own addresses: the last message of each thread, newest first. Pure. */
export function judgeCandidates(threadsByMailbox: { mailbox: string; threads: any[] }[], own: string[], now: number): JudgeEmail[] {
  const mine = new Set(own.map(s => s.toLowerCase()))
  const seen = new Set<string>(), out: JudgeEmail[] = []
  for (const { mailbox, threads } of threadsByMailbox) for (const t of threads || []) {
    const last = (t?.messages || []).at(-1)
    // The same mail in two mailboxes has two Gmail ids but one Message-ID header (review: it was judged twice).
    const key = String(last?.messageId || '').trim().toLowerCase() || `${addr(last?.from)}|${String(last?.subject || '').trim().toLowerCase()}|${Math.round((Number(last?.internalDate) || 0) / 60_000)}`
    if (!last?.id || seen.has(String(last.id)) || seen.has(key)) continue
    const at = Number(last.internalDate) || 0
    if (!at || now - at > MAX_AGE_MS || at > now + 3600_000 || mine.has(addr(last.from))) continue
    seen.add(String(last.id)); seen.add(key)
    out.push({ id: String(last.id), messageId: String(last.messageId || ''), from: String(last.from || ''), subject: String(last.subject || t.subject || ''), snippet: String(last.snippet || ''), internalDate: at, mailbox, labels: Array.isArray(last.labelIds) ? last.labelIds : [], listUnsubscribe: Boolean(last.listUnsubscribe) })
  }
  return out.sort((a, b) => b.internalDate - a.internalDate)
}

export async function runEmailJudgeShadow(telegramId: string, deps: Deps = {}) {
  const now = (deps.now || Date.now)()
  const user = deps.user ? await deps.user(telegramId) : (await supabaseAdmin.from('users').select('telegram_id,whatsapp_id,timezone').eq('telegram_id', ownerKey(telegramId)).maybeSingle()).data
  if (!user || String(user.telegram_id) !== telegramId) return { logged: false, reason: 'user_unavailable' }
  if (!user.whatsapp_id) return { logged: false, reason: 'no_whatsapp' }
  const tz = String(user.timezone || 'Asia/Kolkata')
  const quiet = deps.quiet ? await deps.quiet(telegramId, tz) : await getAlertPreferences(telegramId).then(p => isQuietHour(p, localHour(tz, now)))
  if (quiet) return { logged: false, reason: 'quiet_hours' }
  const boxes = await (deps.mailboxes || ownerMailboxes)(telegramId)
  if (!boxes.length) return { logged: false, reason: 'no_mailbox' }
  const history = await (deps.history || (id => recentShadowRows(id, 'email_judge', 72)))(telegramId)
  if (!history) return { logged: false, reason: 'history_unavailable' }
  const judged = new Set(history.flatMap(r => r.meta.judged_ids || []))
  const read = await Promise.all(boxes.map(async b => ({ mailbox: b.email, threads: b.accessToken ? await (deps.search || (tok => searchGmailThreads(tok, INBOX_QUERY, 25, { raw: true })))(b.accessToken).catch(() => null) : null })))
  const unread = read.filter(r => r.threads === null).map(r => r.mailbox)
  const fresh = judgeCandidates(read.filter(r => r.threads) as any, boxes.map(b => b.email), now).filter(e => !judged.has(e.id)).slice(0, JUDGE_MAX_EMAILS)
  if (!fresh.length) return { logged: false, reason: unread.length ? 'mailbox_read_failed' : 'nothing_new' }
  const owner = Number(telegramId)
  const create = deps.create || ((req: any) => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create(req, { timeout: 20_000, maxRetries: 0 }))
  let usage = { input: 0, output: 0, ok: false, ms: 0 }
  const verdicts = await judgeEmails(fresh, { now, model: HAIKU_MODEL, create, onUsage: u => { usage = u } })
  if (Number.isSafeInteger(owner)) {
    const { meterBrainCall } = await import('./brain')
    meterBrainCall({ telegramId: owner, source: 'brain_shadow', model: HAIKU_MODEL, ms: usage.ms, ok: usage.ok, usage: { input: usage.input, output: usage.output, cacheRead: null, cacheCreation: null } })
  }
  // A failed judge marks nothing as judged, so the same emails are tried again next pass.
  if (!verdicts.length) { console.error('PROACTIVE_SHADOW_FAILED:', JSON.stringify({ kind: 'email_judge', step: 'judge' })); return { logged: false, reason: 'judge_failed' } }
  const today = localDay(now, tz)
  const usedToday = history.filter(r => localDay(r.at, tz) === today).reduce((n, r) => n + (r.meta.item_keys || []).length, 0)
  const byId = new Map(fresh.map(e => [e.id, e]))
  const important = verdicts.filter(v => v.important)
  const picks = important.slice(0, Math.max(0, JUDGE_PER_DAY - usedToday))
  const row = (v: JudgeVerdict) => { const e = byId.get(v.id)!; return { sender: shadowText(e.from, 80), subject: shadowText(e.subject, 100), mailbox: e.mailbox, important: v.important, kind: v.kind, phishing: v.phishing, why: shadowText(v.why, 120) } }
  const logged = await (deps.log || ((id, meta) => logProactiveShadow(id, 'email_judge', meta)))(telegramId, {
    would_send: picks.length ? shadowText(picks.map(v => v.message).filter(Boolean).join('\n\n'), 1200) : null,
    item_keys: picks.map(v => `judge:${v.id}`),
    over_cap: important.length - picks.length,
    judged_ids: verdicts.map(v => v.id),
    verdicts: verdicts.map(row).sort((a, b) => Number(b.important) - Number(a.important)),
    mailboxes: boxes.map(b => b.email), mailbox_read_failed: unread,
    model: HAIKU_MODEL, input_tokens: usage.input, output_tokens: usage.output,
  })
  return { logged, judged: verdicts.length, important: important.length, picks: picks.length }
}
