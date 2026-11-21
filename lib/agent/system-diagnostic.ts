// Read-only self-diagnostic (21 Nov, owner): "run a self-diagnostic" / "health check" used to reach goal intake (a
// list of "check …" clauses became a goal plan) or the general planner (an imperative "run a health check" became an
// agent run with steps and todos). Neither is a mutation the person asked for. This module answers instead.
//
// Rules:
//   - Read-only. It never sends, calls, schedules, approves, buys or changes anything. The only network calls are a
//     Gmail profile GET and a Google Calendar account read; every other check reads saved records of this owner.
//   - Four statuses: operational, degraded, blocked, unverified. "Operational" needs evidence: a provider answer now,
//     or a provider-confirmed record (a WhatsApp delivery receipt, a Bolna-completed call, a watcher run). A saved
//     "connected" flag alone is never operational.
//   - Any check that cannot be read, or times out, is unverified, never assumed fine.
import type { AgentActor } from './actor'

export type DiagnosticStatus = 'operational' | 'degraded' | 'blocked' | 'unverified'
export type DiagnosticCheck = { key: string; label: string; status: DiagnosticStatus; at: string | null; evidence: string }
export type DiagnosticIntent = 'diagnostic' | 'ambiguous' | null

// ---- intent (pure) ----------------------------------------------------------------------------------------------
// Words that name a check of a system. A bare "diagnose" (why am I tired?) or "diagnosis" (the doctor's) is not one.
const DIAG_WORD = /\b(?:self[\s-]?(?:diagnos\w*|tests?|checks?)|diagnostics?|health[\s-]?checks?|system\s+(?:checks?|status|health|tests?)|status\s+checks?|sanity\s+checks?)\b/i
const DIAGNOSE_VERB = /\bdiagnose\b/i
const RUNNING_ASK = /\b(?:is|are)\s+(?:everything|all\s+(?:your\s+|the\s+)?(?:systems?|services?))\s+(?:working|ok|okay|fine|up|running|healthy)\b|^(?:are\s+you|is\s+(?:askgogo|gogo))\s+(?:working|up|running|ok|okay|fine|healthy)(?:\s+(?:properly|correctly|fine|normally|right\s+now|now))?\s*\??$/i
const STRONG_SYSTEM = /\b(?:askgogo|gogo|yourself|self[\s-]?(?:diagnos\w*|tests?|checks?)|system|systems)\b/i
const SYSTEM_OBJ = /\b(?:askgogo|gogo|yourself|your\s+(?:systems?|services?|setup)|the\s+(?:bot|assistant|app)|everything|all\s+(?:your\s+|the\s+)?(?:systems?|services?)|system|systems)\b/i
const COMPONENTS = [
  /\bwhatsapp(?:\s+(?:pairing|link(?:ing)?|connection|delivery))?\b/i,
  /\bconnected\s+(?:services|accounts|apps)\b|\b(?:connections|integrations)\b/i,
  /\bmemory(?:\s+persistence)?\b/i,
  /\b(?:background\s+)?watch(?:ers|es)\b/i,
  /\b(?:pending\s+)?approvals?\b/i,
  /\bvoice(?:\s+calls?)?\b/i,
  /\bscheduled\s+(?:tasks|jobs|reminders)\b|\bschedulers?\b|\bcron\b|\breminder\s+delivery\b/i,
]
// Something other than AskGogo being checked: a person's health, a vehicle, a device, an order, a trip.
const OTHER_SUBJECT = /\b(?:body|blood|bp|sugar|heart|doctor|clinic|hospital|check[\s-]?up|medical|ecg|thyroid|cholesterol|lab|annual|preventive|master\s+health|pregnan\w*|baby|kid|son|daughter|mom|mum|dad|mother|father|wife|husband|car|bike|scooter|vehicle|laptop|phone|computer|pc|mac|printer|router|wifi|website|site|server|order|flight|pnr|train|booking|parcel|delivery\s+(?:of|for))\b|\bmy\s+health\b/i
// The same message also asks for an action; the check never does it.
const ACTION = /\b(?:send|e-?mail|call|ring|book|reserve|buy|order|pay|purchase|schedule|remind\s+me|set\s+up|create|add|delete|remove|cancel|approve|reject|connect|disconnect|reconnect|fix|repair|restart|reset|update|change|turn\s+(?:on|off)|enable|disable|share|post|forward)\b/i
const CHECK_VERB = /\b(?:check|verify|test|confirm|validate|status|working|diagnos\w*|audit|inspect)\b/i
const actionIn = (t: string) => ACTION.test(t.replace(/\bconnected\b/gi, ''))

export function classifyDiagnosticAsk(raw: string): DiagnosticIntent {
  const t = String(raw || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
  if (t.length < 4 || t.length > 600) return null
  const parts = COMPONENTS.filter(re => re.test(t)).length
  const strong = STRONG_SYSTEM.test(t)
  const diag = DIAG_WORD.test(t) || RUNNING_ASK.test(t) || (DIAGNOSE_VERB.test(t) && SYSTEM_OBJ.test(t))
  // A checklist of AskGogo's own parts counts without the word "diagnostic"; anything less is someone else's ask.
  if (!diag && !(parts >= 3 && CHECK_VERB.test(t))) return null
  if (OTHER_SUBJECT.test(t) && !strong) return null
  // A check plus an action ("run a self-diagnostic and send it to Divya"): say the check never acts. Without a clear
  // system word ("book a health check", "remind me to check WhatsApp, approvals and voice notes") it is not ours.
  if (actionIn(t)) return diag && strong ? 'ambiguous' : null
  if (RUNNING_ASK.test(t) || strong || SYSTEM_OBJ.test(t) || parts >= 2) return 'diagnostic'
  return 'ambiguous'
}

/** Cheap pre-check for route files, so the module is only imported for a likely ask. */
export const DIAGNOSTIC_GATE = /diagnos|health[\s-]?check|self[\s-]?(?:test|check)|system|status\s+check|sanity\s+check|everything\s+(?:working|ok|fine|up)|(?:working|running)\s+(?:properly|correctly|fine)|are\s+you\s+(?:working|up|ok|okay|fine|running)|pairing|persistence|watchers/i

export function ambiguousDiagnosticReply(raw: string): string {
  const mixed = actionIn(String(raw || ''))
  return mixed
    ? "I can run a read-only self-diagnostic, but it never sends, calls, books, schedules, approves or changes anything. Reply *run self-diagnostic* for the check on its own, and ask for the other part separately. Nothing was changed."
    : "Do you want me to check AskGogo itself: WhatsApp, connected accounts, memory, watchers, approvals, voice calls and reminders? Reply *run self-diagnostic*. If you meant something else, tell me what to check. Nothing was changed."
}

// ---- formatting (pure) -------------------------------------------------------------------------------------------
const ICON: Record<DiagnosticStatus, string> = { operational: '✅', degraded: '⚠️', blocked: '⛔', unverified: '❔' }
const WORD: Record<DiagnosticStatus, string> = { operational: 'Operational', degraded: 'Degraded', blocked: 'Blocked', unverified: 'Unverified' }

export function whenLabel(iso: string | null | undefined, tz = 'Asia/Kolkata'): string {
  const ms = Date.parse(String(iso || ''))
  if (!Number.isFinite(ms)) return ''
  let zone = tz
  try { new Intl.DateTimeFormat('en-IN', { timeZone: zone }) } catch { zone = 'Asia/Kolkata' }
  return new Intl.DateTimeFormat('en-IN', { timeZone: zone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms))
    .replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase().replace(/^(\d+) ([a-z]{3})/, (_m, d, mo) => `${d} ${mo[0].toUpperCase()}${mo.slice(1)}`)
}

export function formatDiagnostic(checks: DiagnosticCheck[], now: Date, tz = 'Asia/Kolkata'): string {
  const counts = (['operational', 'degraded', 'blocked', 'unverified'] as DiagnosticStatus[])
    .map(s => [s, checks.filter(c => c.status === s).length] as const).filter(([, n]) => n > 0)
  const lines = checks.map(c => `${ICON[c.status]} *${c.label}*: ${WORD[c.status]}${c.at ? ` (${whenLabel(c.at, tz)})` : ''}\n${c.evidence}`)
  return [
    `*AskGogo self-diagnostic*, checked ${whenLabel(now.toISOString(), tz)}`,
    `Overall: ${counts.map(([s, n]) => `${n} ${WORD[s].toLowerCase()}`).join(', ')}.`,
    '',
    lines.join('\n\n'),
    '',
    'Operational means a provider confirmed it or a fresh record shows it working. Unverified means there is no fresh evidence, so I am not assuming it works.',
    'This was a read-only check: nothing was sent, called, scheduled, approved, bought or changed.',
  ].join('\n')
}

export const DIAGNOSTIC_FAILED_TEXT = "I couldn't finish the self-diagnostic just now, so every part is unverified and I'm not assuming any of it works. Nothing was sent, called, scheduled or changed. Please try again in a minute."

// ---- checks ------------------------------------------------------------------------------------------------------
type Db = { from: (table: string) => any }
export type DiagnosticDeps = {
  db?: Db
  now?: Date
  env?: Record<string, string | undefined>
  gmailProbe?: (actor: AgentActor) => Promise<{ email: string | null; checkedAt: string }>
  calendarProbe?: (owner: string, refreshToken: string | null) => Promise<{ emails: string[]; unavailable: number }>
  timeoutMs?: number
}

const HOUR = 3600_000, DAY = 24 * HOUR
const maskPhone = (p: unknown) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? `number ending ${d.slice(-4)}` : 'a number' }
const clean = (v: unknown, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const check = (key: string, label: string, status: DiagnosticStatus, evidence: string, at: string | null = null): DiagnosticCheck => ({ key, label, status, at, evidence })

async function rows(q: PromiseLike<{ data: any; error: any; count?: number | null }>): Promise<{ data: any[]; count: number | null; ok: boolean }> {
  try { const r: any = await q; return r?.error ? { data: [], count: null, ok: false } : { data: Array.isArray(r?.data) ? r.data : r?.data ? [r.data] : [], count: Number.isInteger(r?.count) ? r.count : null, ok: true } }
  catch { return { data: [], count: null, ok: false } }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve(fallback) })
  })
}

export async function whatsappCheck(db: Db, owner: string, user: any, now: Date): Promise<DiagnosticCheck> {
  const L = 'WhatsApp pairing'
  if (!user?.whatsapp_id) return check('whatsapp', L, 'blocked', 'No WhatsApp number is linked to this account.')
  const since = new Date(now.getTime() - 7 * DAY).toISOString()
  const r = await rows(db.from('reminders').select('remind_at,delivery_state').eq('telegram_id', owner)
    .in('delivery_state', ['delivered', 'read', 'failed']).gte('remind_at', since).lte('remind_at', now.toISOString())
    .order('remind_at', { ascending: false }).limit(5))
  if (!r.ok) return check('whatsapp', L, 'unverified', `Linked to the ${maskPhone(user.whatsapp_id)}, but I couldn't read delivery receipts to confirm it.`)
  const latest = r.data[0]
  if (!latest) return check('whatsapp', L, 'unverified', `Linked to the ${maskPhone(user.whatsapp_id)}. No WhatsApp delivery receipt in the last 7 days confirms messages reach you.`)
  if (latest.delivery_state === 'failed') {
    const good = r.data.find((x: any) => x.delivery_state !== 'failed')
    return check('whatsapp', L, 'degraded', `WhatsApp reported the latest reminder as not delivered.${good ? ` The last confirmed delivery was ${whenLabel(good.remind_at)}.` : ''}`, latest.remind_at)
  }
  return check('whatsapp', L, 'operational', `WhatsApp confirmed your reminder as ${latest.delivery_state} (${maskPhone(user.whatsapp_id)}).`, latest.remind_at)
}

function gmailFailure(code: string): { status: DiagnosticStatus; text: string } {
  if (/consent_missing/.test(code)) return { status: 'blocked', text: 'Connected, but reading needs your OK: reconnect Google once at app.askgogo.in/dashboard/settings/email.' }
  if (/reading_disabled/.test(code)) return { status: 'blocked', text: 'Connected, but mail reading is off in your privacy settings.' }
  if (/reconnect_required|not_connected/.test(code)) return { status: 'blocked', text: 'Google no longer accepts the saved sign-in. Reconnect Gmail to restore it.' }
  if (/scope_required|failed:403/.test(code)) return { status: 'degraded', text: 'Google refused the read (403: missing permission, a Workspace block or a rate limit).' }
  if (/failed:401/.test(code)) return { status: 'blocked', text: 'Google rejected the sign-in (401). Reconnect Gmail to restore it.' }
  return { status: 'unverified', text: "Google didn't answer the check, so I can't confirm Gmail is working." }
}

export async function gmailCheck(actor: AgentActor, user: any, probe: NonNullable<DiagnosticDeps['gmailProbe']>, ms: number): Promise<DiagnosticCheck> {
  const L = 'Gmail'
  if (!user?.gmail_connected) return check('gmail', L, 'blocked', 'Not connected.')
  const res = await withTimeout(probe(actor).then(v => ({ ok: true as const, v }), (e: any) => ({ ok: false as const, code: String(e?.message || 'error') })), ms, { ok: false as const, code: 'timeout' })
  if (res.ok) return check('gmail', L, 'operational', `Google answered a live read of the mailbox${res.v.email ? ` ${clean(res.v.email, 80)}` : ''}.`, res.v.checkedAt)
  const f = gmailFailure('code' in res ? res.code : 'error')
  return check('gmail', L, f.status, f.text)
}

export async function calendarCheck(owner: string, user: any, probe: NonNullable<DiagnosticDeps['calendarProbe']>, ms: number, now: Date): Promise<DiagnosticCheck> {
  const L = 'Google Calendar'
  if (!user?.google_calendar_connected) return check('calendar', L, 'blocked', 'Not connected.')
  const res = await withTimeout(probe(owner, user.google_refresh_token ? String(user.google_refresh_token) : null).then(v => ({ ok: true as const, v }), () => ({ ok: false as const })), ms, { ok: false as const })
  if (!res.ok) return check('calendar', L, 'unverified', "Google didn't answer the check, so I can't confirm Calendar is working.")
  const { emails, unavailable } = res.v
  if (!emails.length) return check('calendar', L, 'blocked', 'Google did not accept the saved Calendar sign-in. Reconnect Calendar to restore it.')
  const who = emails.slice(0, 3).map(e => clean(e, 80)).join(', ')
  return unavailable > 0
    ? check('calendar', L, 'degraded', `Google answered for ${who}, but ${unavailable} linked account${unavailable === 1 ? '' : 's'} did not.`, now.toISOString())
    : check('calendar', L, 'operational', `Google answered a live read for ${who}.`, now.toISOString())
}

export async function memoryCheck(db: Db, owner: string): Promise<DiagnosticCheck> {
  const L = 'Memory persistence'
  const [mem, conv] = await Promise.all([
    rows(db.from('memories').select('id', { count: 'exact', head: true }).eq('telegram_id', owner)),
    rows(db.from('conversations').select('created_at').eq('telegram_id', owner).order('created_at', { ascending: false }).limit(1)),
  ])
  if (!mem.ok || !conv.ok) return check('memory', L, 'unverified', "I couldn't read your saved memory back, so I can't confirm it is being kept.")
  const last = conv.data[0]?.created_at || null
  if (!last) return check('memory', L, 'unverified', 'No saved conversation could be read back yet.')
  return check('memory', L, 'operational', `Read back ${mem.count ?? 0} saved memor${mem.count === 1 ? 'y' : 'ies'} and your latest saved message.`, last)
}

export async function watchersCheck(db: Db, owner: string, now: Date): Promise<DiagnosticCheck> {
  const L = 'Background watchers'
  const r = await rows(db.from('agent_watchers').select('id,next_check_at,last_checked_at').eq('telegram_id', owner).eq('active', true).limit(100))
  if (!r.ok) return check('watchers', L, 'unverified', "I couldn't read your watchers.")
  if (!r.data.length) return check('watchers', L, 'unverified', 'No active watchers, so there is no recent run to confirm.')
  const late = r.data.filter((w: any) => { const n = Date.parse(String(w.next_check_at || '')); return Number.isFinite(n) && now.getTime() - n > 2 * HOUR })
  const lastRun = r.data.map((w: any) => String(w.last_checked_at || '')).filter(x => Number.isFinite(Date.parse(x))).sort().pop() || null
  if (late.length) {
    const oldest = late.map((w: any) => String(w.next_check_at)).sort()[0]
    return check('watchers', L, 'degraded', `${late.length} of ${r.data.length} active watchers are more than 2 hours overdue (oldest was due ${whenLabel(oldest)}).`, lastRun)
  }
  if (lastRun && now.getTime() - Date.parse(lastRun) <= DAY) return check('watchers', L, 'operational', `${r.data.length} active, none overdue. The latest run finished at the time shown.`, lastRun)
  return check('watchers', L, 'unverified', `${r.data.length} active, but none has a run recorded in the last 24 hours.`, lastRun)
}

export async function approvalsCheck(db: Db, owner: string, now: Date): Promise<DiagnosticCheck> {
  const L = 'Pending approvals'
  const r = await rows(db.from('agent_approvals').select('id,requested_at', { count: 'exact' }).eq('telegram_id', owner).eq('status', 'pending').order('requested_at', { ascending: true }).limit(20))
  if (!r.ok) return check('approvals', L, 'unverified', "I couldn't read the approval queue.")
  const n = r.count ?? r.data.length
  if (!n) return check('approvals', L, 'operational', 'The approval queue was read: nothing is waiting for your OK.', now.toISOString())
  const oldest = r.data[0]?.requested_at || null
  const stale = oldest && now.getTime() - Date.parse(oldest) > 7 * DAY
  return check('approvals', L, stale ? 'degraded' : 'operational', `${n} waiting for your OK${oldest ? `, the oldest since ${whenLabel(oldest)}` : ''}.${stale ? ' Some are over a week old.' : ''} Nothing runs without your approval.`, now.toISOString())
}

export async function voiceCheck(db: Db, owner: string, env: Record<string, string | undefined>, now: Date): Promise<DiagnosticCheck> {
  const L = 'Voice calls'
  const [{ capabilityPaused }, voice] = await Promise.all([import('./policy'), import('./voice-call')])
  if (capabilityPaused('voice_calls', env as any)) return check('voice', L, 'blocked', 'Calling is paused by the safety switch.')
  if (!voice.voiceCallsEnabled(env)) return check('voice', L, 'blocked', 'The calling provider is not configured.')
  const hours = voice.callingHoursProblem('+910000000000', now, env) ? ' Outside 9 am to 9 pm India time, calls are not placed.' : ''
  const r = await rows(db.from('agent_runs').select('status,completed_at,updated_at,created_at').eq('telegram_id', owner).eq('type', 'voice_call').order('created_at', { ascending: false }).limit(5))
  if (!r.ok) return check('voice', L, 'unverified', `Configured, but I couldn't read your call history.${hours}`)
  const last = r.data.find((x: any) => ['completed', 'failed', 'outcome_unknown'].includes(String(x.status)))
  if (!last) return check('voice', L, 'unverified', `Configured, but no call has a provider-confirmed result yet.${hours}`)
  const at = last.completed_at || last.updated_at || last.created_at || null
  if (last.status === 'completed') return check('voice', L, 'operational', `The calling provider reported your latest call as completed.${hours}`, at)
  return check('voice', L, 'degraded', `Your latest call ${last.status === 'failed' ? 'failed at the provider' : 'has an unconfirmed outcome'}.${hours}`, at)
}

export async function scheduledCheck(db: Db, owner: string, now: Date): Promise<DiagnosticCheck> {
  const L = 'Scheduled reminders'
  const [overdue, latest, upcoming] = await Promise.all([
    rows(db.from('reminders').select('remind_at', { count: 'exact' }).eq('telegram_id', owner).eq('sent', false).in('delivery_state', ['pending', 'claimed'])
      .lt('remind_at', new Date(now.getTime() - 15 * 60_000).toISOString()).order('remind_at', { ascending: true }).limit(1)),
    rows(db.from('reminders').select('remind_at,delivery_state').eq('telegram_id', owner).in('delivery_state', ['provider_accepted', 'delivered', 'read'])
      .lte('remind_at', now.toISOString()).order('remind_at', { ascending: false }).limit(1)),
    rows(db.from('reminders').select('id', { count: 'exact', head: true }).eq('telegram_id', owner).eq('sent', false).gt('remind_at', now.toISOString())),
  ])
  if (!overdue.ok || !latest.ok) return check('scheduled', L, 'unverified', "I couldn't read your reminder schedule.")
  const ahead = upcoming.ok && upcoming.count !== null ? ` ${upcoming.count} upcoming.` : ''
  const late = overdue.count ?? overdue.data.length
  if (late > 0) return check('scheduled', L, 'degraded', `${late} reminder${late === 1 ? ' is' : 's are'} more than 15 minutes past due and not sent (oldest due ${whenLabel(overdue.data[0]?.remind_at)}).${ahead}`, overdue.data[0]?.remind_at || null)
  const last = latest.data[0]
  if (last && ['delivered', 'read'].includes(String(last.delivery_state)) && now.getTime() - Date.parse(last.remind_at) <= 7 * DAY)
    return check('scheduled', L, 'operational', `Nothing overdue. WhatsApp confirmed the latest reminder as ${last.delivery_state}.${ahead}`, last.remind_at)
  if (last && last.delivery_state === 'provider_accepted') return check('scheduled', L, 'unverified', `Nothing overdue. The latest reminder was accepted by WhatsApp, but delivery was not confirmed.${ahead}`, last.remind_at)
  return check('scheduled', L, 'unverified', `Nothing overdue, but no reminder delivery in the last 7 days confirms the scheduler.${ahead}`, last?.remind_at || null)
}

export async function runSystemDiagnostic(actor: AgentActor, deps: DiagnosticDeps = {}): Promise<{ text: string; checks: DiagnosticCheck[] }> {
  const tg = actor?.legacyTelegramId
  if (!Number.isSafeInteger(tg) || tg === 0) throw new Error('diagnostic_owner_invalid')
  const owner = String(tg)
  const now = deps.now || new Date(), env = deps.env || process.env, ms = deps.timeoutMs ?? 6000
  const db: Db = deps.db || (await import('@/lib/supabase-admin')).supabaseAdmin
  const gmailProbe = deps.gmailProbe || (async (a: AgentActor) => (await import('./google-workspace-read')).probeWorkspaceGmail(a))
  const calendarProbe = deps.calendarProbe || (async (o: string, refresh: string | null) => {
    let unavailable = 0
    const accounts = await (await import('@/lib/services/google-calendar-accounts')).getCalendarAccountAccess(o, refresh, () => { unavailable++ })
    return { emails: accounts.map(a => a.email).filter((e): e is string => !!e), unavailable }
  })
  const u = await rows(db.from('users').select('whatsapp_id,gmail_connected,google_calendar_connected,google_refresh_token').eq('telegram_id', owner).maybeSingle())
  const user = u.ok ? u.data[0] || null : null
  const guard = (key: string, label: string, p: Promise<DiagnosticCheck>) => withTimeout(p, ms + 1000, check(key, label, 'unverified', 'The check did not finish in time.'))
  const unreadUser = (key: string, label: string) => Promise.resolve(check(key, label, 'unverified', "I couldn't read your account record."))
  const checks = await Promise.all([
    u.ok ? guard('whatsapp', 'WhatsApp pairing', whatsappCheck(db, owner, user, now)) : unreadUser('whatsapp', 'WhatsApp pairing'),
    u.ok ? guard('gmail', 'Gmail', gmailCheck(actor, user, gmailProbe, ms)) : unreadUser('gmail', 'Gmail'),
    u.ok ? guard('calendar', 'Google Calendar', calendarCheck(owner, user, calendarProbe, ms, now)) : unreadUser('calendar', 'Google Calendar'),
    guard('memory', 'Memory persistence', memoryCheck(db, owner)),
    guard('watchers', 'Background watchers', watchersCheck(db, owner, now)),
    guard('approvals', 'Pending approvals', approvalsCheck(db, owner, now)),
    guard('voice', 'Voice calls', voiceCheck(db, owner, env, now)),
    guard('scheduled', 'Scheduled reminders', scheduledCheck(db, owner, now)),
  ])
  return { text: formatDiagnostic(checks, now, actor.timezone || 'Asia/Kolkata'), checks }
}

/** Entry for both surfaces. Null when the message is not a diagnostic ask; never throws. */
export async function trySystemDiagnostic(actor: AgentActor, text: string, deps: DiagnosticDeps = {}) {
  const intent = classifyDiagnosticAsk(text)
  if (!intent) return null
  const base = { handledBy: 'system-diagnostic', status: 'completed' as const, readOnly: true, mutated: false }
  if (intent === 'ambiguous') return { ...base, handledBy: 'system-diagnostic-clarify', text: ambiguousDiagnosticReply(text), checks: [] as DiagnosticCheck[] }
  try {
    const out = await runSystemDiagnostic(actor, deps)
    console.log('SYSTEM_DIAGNOSTIC:', JSON.stringify(Object.fromEntries(out.checks.map(c => [c.key, c.status]))))
    return { ...base, text: out.text, checks: out.checks }
  } catch (err: any) {
    console.error('SYSTEM_DIAGNOSTIC_FAILED:', String(err?.message || 'error').replace(/[^a-z0-9_:]/gi, '').slice(0, 60))
    return { ...base, text: DIAGNOSTIC_FAILED_TEXT, checks: [] as DiagnosticCheck[] }
  }
}
