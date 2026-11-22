// 21 Nov (owner): "run a self-diagnostic" reached goal intake (a list of "check …" clauses became a goal plan) or the
// general planner (an imperative "run a health check" became an agent run with steps and todos). Now it gets a
// read-only report: operational / degraded / blocked / unverified with a time and evidence, never success on a flag.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const d: any = await import('../lib/agent/system-diagnostic')
const goal: any = await import('../lib/agent/goal-intake')

// ---- intent -------------------------------------------------------------------------------------------------------
const DIAGNOSTIC = [
  'Run a self-diagnostic',
  'run self-diagnostic',
  'Run a full system health check',
  'AskGogo health check',
  'system status',
  'Are you working properly?',
  'Is everything working?',
  'Can you diagnose yourself?',
  'Self test please',
  'Gogo, please run a system check',
  'run diagnostics on yourself',
  'check all your systems',
  'Run a self-diagnostic: check WhatsApp pairing, check connected services, check memory persistence, check background watchers and check pending approvals',
  'Check WhatsApp pairing, connected services, memory persistence, background watchers, pending approvals, voice and scheduled tasks',
]
for (const t of DIAGNOSTIC) assert.equal(d.classifyDiagnosticAsk(t), 'diagnostic', t)
const AMBIGUOUS = ['Run a health check', 'diagnostics', 'run a sanity check', 'status check', 'Do a quick health check please']
for (const t of AMBIGUOUS) assert.equal(d.classifyDiagnosticAsk(t), 'ambiguous', t)
// Review (PR #1559): every one of these was taken by the first version. Each belongs to another handler.
const NOT_OURS = [
  'remind me to do a system check tomorrow at 10', 'Remind me tomorrow 10am: Tipplr system health check', 'Remind me to update the system status report at 5pm',
  'system check tomorrow 10am', 'a/c system check tomorrow', 'remind Divya to do a system check tomorrow',
  'reject the system status email', 'approve the system status email', 'yes send the system status update', 'draft an email to Nithin with the system status',
  'is everything ok with divya', 'is everything ok at home?', 'is everything ok between us', "is everything fine? I haven't heard from you", 'is everything ok?',
  "my car's system check light is on", 'my immune system diagnostics report is ready', 'Tipplr system status', "what's the system status of tipplr orders",
  'is everything ok with the tipplr dashboard', 'note: self-test the generator monthly', 'what does system health check mean', 'skip the system check',
  'sanity check my resume', 'do a sanity check on my budget', 'run a health check on my mutual funds', 'do a health check of my portfolio',
  'status check on my visa application', 'diagnostics for the AC', 'whatsapp status check',
  'Book a health check for mom on Saturday', 'book a full body health check', 'health check up for Nithin next week', 'Run a health check on my car',
  'what is my diagnosis', 'diagnose why I feel tired', "what's the status of my flight", 'check the status of my order', 'check my pending approvals',
  'remind me to check WhatsApp pairing, approvals queue and voice notes tomorrow', 'call Divya and check if she is working today',
  "Organize Divya's birthday, check flight prices to Goa and prepare three emails", 'are you there?', 'approvals', 'watchers', 'hi',
  'Fwd: Weekly system health check report\nAll services green.',
  'check the memory, voice and integrations sections in the PRD', 'check memory usage, voice quality and integrations of the laptop',
  'Check integrations, memory and voice for CreditIQ', 'Check memory, voice notes and integrations for the Tipplr team',
  'test voice, memory and integrations on the new build', 'check my memory, integrations and voice settings',
]
for (const t of NOT_OURS) assert.equal(d.classifyDiagnosticAsk(t), null, t)
console.log('✓ diagnostic, ambiguous and unrelated asks are told apart')

// The root cause: the multi-check wording passed goal intake's gate (3+ "check …" clauses), so it became a goal plan.
assert.equal(goal.looksLikeGoalList(DIAGNOSTIC[12]), true, 'the original wording is a goal list to goal intake')
// The gate in each route file lets every ask through to the module.
for (const t of [...DIAGNOSTIC, ...AMBIGUOUS]) assert.ok(d.DIAGNOSTIC_GATE.test(t), 'gate: ' + t)

// ---- the routes: the diagnostic runs before goal intake, the brain and the general planner -------------------------
const dash = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
const iDiag = dash.indexOf('trySystemDiagnostic('), iGoal = dash.indexOf("import('@/lib/agent/goal-intake')"), iBrain = dash.indexOf("import('@/lib/agent/brain')"), iPlan = dash.indexOf('await tryRunGeneralPlan(')
assert.ok(iDiag > 0 && iDiag < iGoal && iDiag < iBrain && iDiag < iPlan, 'dashboard: diagnostic first')
assert.match(dash.slice(iDiag, iDiag + 900), /readOnly:true,mutated:false/)
const wa = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const wDiag = wa.indexOf('trySystemDiagnostic('), wGoal = wa.indexOf("const intake = await import('@/lib/agent/goal-intake')"), wBrain = wa.indexOf("import('@/lib/agent/brain').then(m => m.runBrain(")
assert.ok(wDiag > 0 && wDiag < wGoal && wDiag < wBrain, 'whatsapp: diagnostic before goal intake and the brain')
const brain: any = await import('../lib/agent/brain')
for (const t of DIAGNOSTIC.slice(0, 7)) assert.equal(brain.isExactCommand(t), true, 'brain leaves it alone: ' + t)
for (const t of ['remind me to do a system check tomorrow at 10', 'is everything ok with divya']) assert.equal(brain.isExactCommand(t), false, 'brain still gets: ' + t)
const wBlock = wa.slice(wDiag - 700, wDiag)
assert.match(wBlock, /!preserveFriendFlow && !forwardedMessage && !approvalIntent\(text\)/, 'whatsapp: forwarded, friend and approval replies keep their handlers')
assert.ok(wDiag > wa.indexOf('const forwardedMessage ='), 'whatsapp: after forwarded detection')
console.log('✓ both surfaces answer it before goal intake, the brain and the planner')

// ---- the checks, against a recording fake database ----------------------------------------------------------------
const NOW = new Date('2026-11-21T16:00:00Z') // 9:30 pm IST
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
type Tables = Record<string, any[] | 'error'>
function fakeDb(tables: Tables) {
  const writes: string[] = []
  const from = (table: string) => {
    const f: any[] = []; let head = false, countOn = false, limit = Infinity, order: [string, boolean] | null = null, single = false
    const q: any = {
      select: (_c: string, o?: any) => { head = !!o?.head; countOn = o?.count === 'exact'; return q },
      eq: (k: string, v: any) => (f.push((r: any) => String(r[k]) === String(v)), q),
      in: (k: string, v: any[]) => (f.push((r: any) => v.includes(r[k])), q),
      gte: (k: string, v: any) => (f.push((r: any) => String(r[k]) >= v), q),
      gt: (k: string, v: any) => (f.push((r: any) => String(r[k]) > v), q),
      lte: (k: string, v: any) => (f.push((r: any) => String(r[k]) <= v), q),
      lt: (k: string, v: any) => (f.push((r: any) => String(r[k]) < v), q),
      order: (k: string, o: any) => (order = [k, o?.ascending !== false], q),
      limit: (n: number) => (limit = n, q),
      maybeSingle: () => (single = true, q),
      then: (res: any, rej: any) => {
        const t = tables[table]
        if (t === 'error') return Promise.resolve({ data: null, error: { message: 'boom' }, count: null }).then(res, rej)
        let out = (t || []).filter(r => f.every(fn => fn(r)))
        if (order) { const [k, asc] = order; out = [...out].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1)) }
        const count = out.length
        out = out.slice(0, limit)
        return Promise.resolve({ data: head ? null : single ? out[0] || null : out, error: null, count: countOn ? count : null }).then(res, rej)
      },
    }
    for (const w of ['insert', 'update', 'upsert', 'delete', 'rpc']) q[w] = () => { writes.push(`${table}.${w}`); return q }
    return q
  }
  return { db: { from, rpc: () => { writes.push('rpc'); return Promise.resolve({}) } }, writes }
}
const OWNER = '4205611234567' // 13 digits: kept exact as a string
const actor = { userId: 'u', legacyTelegramId: Number(OWNER), whatsappId: '+918884501501', name: 'Nithin', timezone: 'Asia/Kolkata' }
const healthy: Tables = {
  users: [{ telegram_id: OWNER, whatsapp_id: '+918884501501', gmail_connected: true, google_calendar_connected: true, google_refresh_token: 'enc' }],
  reminders: [
    { telegram_id: OWNER, remind_at: ago(2), delivery_state: 'read', sent: true },
    { telegram_id: OWNER, remind_at: new Date(NOW.getTime() + 86400_000).toISOString(), delivery_state: 'pending', sent: false },
  ],
  memories: [{ telegram_id: OWNER, id: 1 }, { telegram_id: OWNER, id: 2 }],
  conversations: [{ telegram_id: OWNER, created_at: ago(0.1) }],
  agent_watchers: [{ telegram_id: OWNER, active: true, next_check_at: ago(-1), last_checked_at: ago(1) }],
  agent_approvals: [{ telegram_id: OWNER, status: 'approved', resolved_at: ago(20) }],
  agent_runs: [{ telegram_id: OWNER, type: 'voice_call', status: 'completed', completed_at: ago(30), started_at: ago(30) }],
}
const probes = {
  gmailProbe: async () => ({ email: 'goverdhan@tipplr.in', checkedAt: NOW.toISOString() }),
  calendarProbe: async (owner: string) => { assert.equal(owner, OWNER, 'exact owner string'); return { emails: ['goverdhan.md@gmail.com'], accounts: 1, unavailable: 0 } },
}
const env = { BOLNA_API_KEY: 'inert' }
{
  const { db, writes } = fakeDb(healthy)
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env, ...probes, full: true })
  const by = Object.fromEntries(out.checks.map((c: any) => [c.key, c]))
  for (const k of ['whatsapp', 'gmail', 'calendar', 'memory', 'watchers', 'approvals', 'voice', 'scheduled']) assert.equal(by[k].status, 'operational', k + ': ' + by[k].evidence)
  for (const c of out.checks) { assert.ok(c.at && Number.isFinite(Date.parse(c.at)), 'timestamp: ' + c.key); assert.ok(c.evidence.length > 10, 'evidence: ' + c.key) }
  assert.match(by.whatsapp.evidence, /WhatsApp confirmed your reminder as read \(number ending 1501\)/)
  assert.match(by.gmail.evidence, /Google answered a live read of the mailbox goverdhan@tipplr\.in/)
  assert.match(by.voice.evidence, /Outside 9 am to 9 pm India time, calls are not placed/)
  assert.match(out.text, /^\*AskGogo self-diagnostic\*, checked 21 Nov, 9:30 pm/)
  assert.match(out.text, /Overall: 8 operational\./)
  assert.match(out.text, /read-only check: nothing was sent, called, scheduled, approved, bought or changed/)
  assert.doesNotMatch(out.text, /\+91|8884501501/, 'no full phone number in the report')
  assert.deepEqual(writes, [], 'no database writes')
}
console.log('✓ a healthy account: eight checks operational, each with a time and evidence, no writes')

// Saved "connected" flags with no provider answer are never operational.
{
  const { db, writes } = fakeDb({ ...healthy, reminders: [], agent_runs: [], agent_watchers: [], conversations: [], agent_approvals: [] })
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env, timeoutMs: 50,
    gmailProbe: () => new Promise(() => {}), calendarProbe: async () => { throw new Error('network') } })
  const by = Object.fromEntries(out.checks.map((c: any) => [c.key, c]))
  for (const k of ['whatsapp', 'gmail', 'calendar', 'memory', 'watchers', 'approvals', 'voice', 'scheduled']) assert.equal(by[k].status, 'unverified', k + ': ' + by[k].evidence)
  assert.match(by.approvals.evidence, /No approval decision in the last 7 days/)
  assert.match(by.gmail.evidence, /Google didn't answer/)
  assert.match(by.whatsapp.evidence, /No WhatsApp delivery receipt in the last 7 days/)
  assert.doesNotMatch(out.text, /\b8 operational\b/)
  assert.deepEqual(writes, [])
}
console.log('✓ no provider answer or no fresh record: unverified, never operational')

// Degraded and blocked, with the reason.
{
  const t: Tables = {
    ...healthy,
    users: [{ telegram_id: OWNER, whatsapp_id: '+918884501501', gmail_connected: true, google_calendar_connected: false }],
    reminders: [
      { telegram_id: OWNER, remind_at: ago(1), delivery_state: 'failed', sent: true },
      { telegram_id: OWNER, remind_at: ago(5), delivery_state: 'read', sent: true },
      { telegram_id: OWNER, remind_at: ago(3), delivery_state: 'pending', sent: false },
    ],
    agent_watchers: [{ telegram_id: OWNER, active: true, next_check_at: ago(6), last_checked_at: ago(30) }],
    agent_approvals: [{ telegram_id: OWNER, status: 'pending', requested_at: ago(24 * 9) }],
    agent_runs: [{ telegram_id: OWNER, type: 'voice_call', status: 'outcome_unknown', updated_at: ago(2), started_at: ago(2) }],
  }
  const { db, writes } = fakeDb(t)
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env: { ...env }, gmailProbe: async () => { throw new Error('workspace_email_consent_missing') }, calendarProbe: probes.calendarProbe })
  const by = Object.fromEntries(out.checks.map((c: any) => [c.key, c]))
  assert.equal(by.whatsapp.status, 'degraded'); assert.match(by.whatsapp.evidence, /not delivered\. The last confirmed delivery was/)
  assert.equal(by.gmail.status, 'blocked'); assert.match(by.gmail.evidence, /reading needs your OK/)
  assert.equal(by.calendar.status, 'blocked'); assert.equal(by.calendar.evidence, 'Not connected.')
  assert.equal(by.watchers.status, 'degraded'); assert.match(by.watchers.evidence, /1 of 1 active watchers are more than 2 hours overdue/)
  assert.equal(by.approvals.status, 'degraded'); assert.match(by.approvals.evidence, /1 waiting for your OK.*over a week old/)
  const cal = await d.calendarCheck(OWNER, { google_calendar_connected: true }, async () => ({ emails: [], accounts: 1, unavailable: 1 }), 100, NOW)
  assert.equal(cal.status, 'unverified', 'token accepted, calendar not returned: unverified, not blocked')
  assert.equal(by.voice.status, 'degraded'); assert.match(by.voice.evidence, /unconfirmed outcome/)
  assert.equal(by.scheduled.status, 'degraded'); assert.match(by.scheduled.evidence, /1 reminder is more than 15 minutes past due and not sent/)
  assert.deepEqual(writes, [])
}
console.log('✓ failures are reported as degraded or blocked with the reason')

// Kill switch and missing provider config block voice; a missing WhatsApp link blocks pairing.
{
  const { db } = fakeDb({ ...healthy, users: [{ telegram_id: OWNER, whatsapp_id: null }] })
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env: { BOLNA_API_KEY: 'inert', GOGO_VOICE_CALLS: 'off' }, ...probes })
  const by = Object.fromEntries(out.checks.map((c: any) => [c.key, c]))
  assert.equal(by.whatsapp.status, 'blocked')
  assert.equal(by.voice.status, 'blocked'); assert.match(by.voice.evidence, /paused by the safety switch/)
  const out2 = await d.runSystemDiagnostic(actor, { db, now: NOW, env: {}, ...probes })
  assert.match(out2.checks.find((c: any) => c.key === 'voice').evidence, /not configured/)
}
console.log('✓ the voice kill switch and missing provider config are reported as blocked')

// Unreadable tables: unverified, never a crash or a claim.
{
  const { db } = fakeDb(Object.fromEntries(Object.keys(healthy).map(k => [k, 'error'])) as Tables)
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env, ...probes })
  for (const c of out.checks) assert.equal(c.status, 'unverified', c.key)
}
console.log('✓ unreadable records: every check unverified')

// ---- safe fallback ------------------------------------------------------------------------------------------------
{
  const { db, writes } = fakeDb(healthy)
  const amb = await d.trySystemDiagnostic(actor, 'Run a health check', { db, now: NOW, env, ...probes })
  assert.equal(amb.handledBy, 'system-diagnostic-clarify'); assert.equal(amb.readOnly, true); assert.equal(amb.mutated, false)
  assert.match(amb.text, /Reply \*run self-diagnostic\*.*Nothing was changed\./s)
  assert.equal(await d.trySystemDiagnostic(actor, 'Run a self-diagnostic and send the report to Divya', { db, now: NOW, env, ...probes }), null, 'an ask with an action keeps its own handler')
  const broken = await d.trySystemDiagnostic({ ...actor, legacyTelegramId: 2 ** 53 + 2 }, 'Run a self-diagnostic', { db, now: NOW, env, ...probes })
  assert.equal(broken.text, d.DIAGNOSTIC_FAILED_TEXT); assert.equal(broken.mutated, false)
  assert.match(broken.text, /every part is unverified/)
  assert.equal(await d.trySystemDiagnostic(actor, 'Book a health check for mom', { db, now: NOW, env, ...probes }), null)
  assert.deepEqual(writes, [])
}
console.log('✓ ambiguous asks get a clarifying question, a failure says unverified, unrelated asks fall through')
// The inline gates in both routes are the module's gate, character for character.
assert.ok(dash.includes(d.DIAGNOSTIC_GATE.source) && wa.includes(d.DIAGNOSTIC_GATE.source), 'route gates match DIAGNOSTIC_GATE')
console.log('✓ route gates match the module gate')

// 21 Nov live: the voice check selected agent_runs.created_at, which does not exist, so the read failed. Every column
// this module selects, filters or orders on in the agent OS tables must exist in supabase/agent-os-v1.sql.
{
  const schema = readFileSync(new URL('../supabase/agent-os-v1.sql', import.meta.url), 'utf8')
  const cols = (table: string) => new Set((schema.match(new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] || '').split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean))
  const mod = readFileSync(new URL('../lib/agent/system-diagnostic.ts', import.meta.url), 'utf8')
  for (const table of ['agent_runs', 'agent_approvals', 'agent_watchers', 'agent_activity']) {
    const known = cols(table); assert.ok(known.size > 5, 'schema parsed: ' + table)
    for (const m of mod.matchAll(new RegExp(`from\\('${table}'\\)([^\\n]*)`, 'g'))) {
      const used = [...m[1].matchAll(/\.select\('([^']*)'/g)].flatMap(x => x[1].split(',')).concat([...m[1].matchAll(/\.(?:eq|in|order|gte|lte|lt|gt)\('([a-z_]+)'/g)].map(x => x[1]))
      for (const c of used) assert.ok(known.has(c.trim()), `${table}.${c.trim()} exists`)
    }
  }
}
console.log('✓ every agent_runs / agent_approvals / agent_watchers column the diagnostic reads exists in the schema')

// ---- 22 Nov: the summary reply (owner-approved after comparing with Instinct) ------------------------------------
{
  const withQueue: Tables = { ...healthy,
    agent_activity: [
      { telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(5), message: 'Gold alert: 24K at ₹12,557/g, about 15% below your Oct 19 level.' },
      { telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(24 * 5), message: 'Too old to show' },
      { telegram_id: '999', event_type: 'watcher_triggered', created_at: ago(1), message: "Someone else's alert" },
    ],
    agent_open_loops: [{ telegram_id: OWNER, status: 'active', kind: 'followup', priority: 0.9, title: 'Swiggy Builders: no reply to your Nov 13 submission', due_at: null }],
  }
  const { db, writes } = fakeDb(withQueue)
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env, ...probes })
  assert.match(out.text, /^\*AskGogo self-diagnostic\*, 21 Nov, 9:30 pm\n✅ All 8 checks OK, checked just now\./)
  assert.doesNotMatch(out.text, /WhatsApp pairing/, 'working checks are not listed one by one')
  assert.match(out.text, /\*In the last 3 days\*\n• 21 Nov, 4:30 pm · Gold alert: 24K at ₹12,557\/g/)
  assert.doesNotMatch(out.text, /Too old to show|Someone else/)
  assert.match(out.text, /\*Still open\*\n• Swiggy Builders: no reply to your Nov 13 submission/)
  assert.match(out.text, /Reply \*diagnostic details\* for every check and its evidence\. This was read-only/)
  assert.deepEqual(writes, [])
}
{
  // One real problem is listed with its reason; quiet items are named in one line and not counted as problems.
  const t: Tables = { ...healthy, agent_approvals: [], agent_watchers: [],
    agent_runs: [{ telegram_id: OWNER, type: 'voice_call', status: 'outcome_unknown', updated_at: ago(2), started_at: ago(2) }] }
  const { db } = fakeDb(t)
  const out = await d.runSystemDiagnostic(actor, { db, now: NOW, env, ...probes })
  assert.match(out.text, /\n⚠️ 5 OK, 1 needs a look:\n⚠️ \*Voice calls\*: Degraded \(21 Nov, 7:30 pm\)\. Your latest call has an unconfirmed outcome/)
  assert.match(out.text, /\nNothing recent to test: Background watchers, Pending approvals\./)
  assert.doesNotMatch(out.text, /❔/, 'quiet items get no warning icon')
}
assert.equal(d.classifyDiagnosticAsk('diagnostic details'), 'diagnostic')
assert.equal(d.wantsDiagnosticDetails('diagnostic details'), true)
assert.equal(d.wantsDiagnosticDetails('Show me the full self-diagnostic report'), true)
assert.equal(d.wantsDiagnosticDetails('full diagnostic'), false, 'needs self or system')

assert.equal(d.wantsDiagnosticDetails('Run a self-diagnostic'), false)
{
  const { db } = fakeDb(healthy)
  const full = await d.trySystemDiagnostic(actor, 'diagnostic details', { db, now: NOW, env, ...probes })
  assert.match(full.text, /Overall: 8 operational\./); assert.match(full.text, /WhatsApp pairing/)
  const short = await d.trySystemDiagnostic(actor, 'Run a self-diagnostic', { db, now: NOW, env, ...probes })
  assert.match(short.text, /All 8 checks OK/)
}
console.log('✓ summary first, only problems listed, quiet items in one line, last-3-days alerts and open follow-ups; details on request')
// ---- Review of PR #1563 ---------------------------------------------------------------------------------------------
{
  // A call stuck as running is never 'nothing to test'.
  const stuck: Tables = { ...healthy, agent_runs: [{ telegram_id: OWNER, type: 'voice_call', status: 'running', updated_at: ago(3), started_at: ago(3) }] }
  let out = await d.runSystemDiagnostic(actor, { ...fakeDb(stuck), now: NOW, env, ...probes, full: true })
  let voice = out.checks.find((c: any) => c.key === 'voice'); assert.equal(voice.status, 'degraded'); assert.ok(!voice.quiet)
  const fresh: Tables = { ...healthy, agent_runs: [{ telegram_id: OWNER, type: 'voice_call', status: 'running', updated_at: ago(0.1), started_at: ago(0.1) }] }
  out = await d.runSystemDiagnostic(actor, { ...fakeDb(fresh), now: NOW, env, ...probes, full: true })
  voice = out.checks.find((c: any) => c.key === 'voice'); assert.equal(voice.status, 'unverified'); assert.equal(voice.quiet, false, 'a call in progress is not quiet')
  // Approvals: a failed decisions read is never hidden as quiet.
  const db0 = fakeDb({ ...healthy, agent_approvals: [] }).db
  const failing = { from: (t: string) => { const q = db0.from(t); if (t !== 'agent_approvals') return q; const orig = q.in; q.in = (...a: any[]) => { const r = orig(...a); r.then = (res: any) => Promise.resolve({ data: null, error: { message: 'x' } }).then(res); return r }; return q } }
  const ap = await d.approvalsCheck(failing, OWNER, NOW)
  assert.equal(ap.status, 'unverified'); assert.equal(ap.quiet, false)
}
{
  // Housekeeping rows never fill the alerts; markdown characters are stripped; spacing is single.
  const t: Tables = { ...healthy,
    agent_activity: [
      { telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(1), message: 'Merged duplicate watch: iPhone', metadata_json: { reason: 'duplicate' } },
      { telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(2), message: 'Contextual watch expired: BLR to BOM', metadata_json: {} },
      { telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(3), message: 'Background Gogo saw the gold rate cross your level: _24K_ ~gold~', metadata_json: { type: 'gold' } },
    ] }
  const out = await d.runSystemDiagnostic(actor, { ...fakeDb(t), now: NOW, env, ...probes })
  assert.doesNotMatch(out.text, /Merged duplicate|Contextual watch expired/)
  assert.match(out.text, /Background Gogo saw the gold rate cross your level: 24K gold/)
  assert.doesNotMatch(out.text, /\n\n\n/, 'never two blank lines')
  assert.match(out.text, /All 8 checks OK, checked just now\.\n\n\*In the last 3 days\*/)
}
{
  const one = d.formatDiagnosticSummary([{ key: 'm', label: 'Memory', status: 'operational', evidence: 'x', at: null }], NOW)
  assert.match(one, /1 check OK, checked just now\./)
  const none = d.formatDiagnosticSummary([{ key: 'w', label: 'Background watchers', status: 'unverified', evidence: 'x', at: null, quiet: true }], NOW)
  assert.match(none, /Nothing failed, and there was nothing recent to test\.\nNothing recent to test: Background watchers\./)
  assert.doesNotMatch(none, /All 0/)
}
// "diagnostic report?" may be a lab or car report: ambiguous, never the check outright.
for (const t of ['diagnostic report', 'the diagnostic report', 'show me the diagnostic report', 'diagnostic report?', 'diagnostics report', 'run a full diagnostic', 'full diagnostic']) assert.notEqual(d.classifyDiagnosticAsk(t), 'diagnostic', t)
for (const t of ['send me the diagnostic report', 'car diagnostic report', 'my diagnostic report', 'lab diagnostic report', 'what did the diagnostic report say']) assert.equal(d.classifyDiagnosticAsk(t), null, t)
for (const t of ['diagnostic details', 'self-diagnostic report', 'full self-diagnostic', 'system diagnostic report']) { assert.equal(d.classifyDiagnosticAsk(t), 'diagnostic', t); assert.equal(d.wantsDiagnosticDetails(t), true, t) }
console.log('✓ review fixes: stuck calls and failed reads are never quiet, housekeeping is not an alert, bare "diagnostic report" asks first')
// 22 Nov live: identical alerts and identical open items were listed several times.
{
  const t: Tables = { ...healthy,
    agent_activity: [1, 2, 3].map(h => ({ telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(h), message: 'Mail alerts: 1 email(s) flagged.', metadata_json: { type: 'email_triage' } })),
    agent_open_loops: [0.9, 0.8, 0.7].map(p => ({ telegram_id: OWNER, status: 'active', kind: 'followup', priority: p, title: p === 0.7 ? 'Review service billing notice — payment failed' : 'Review service billing notice — Payment Failed And Shutdown Coming Soon', due_at: null })),
  }
  const out = await d.runSystemDiagnostic(actor, { ...fakeDb(t), now: NOW, env, ...probes })
  assert.equal((out.text.match(/Mail alerts: 1 email\(s\) flagged\./g) || []).length, 1); assert.match(out.text, /\(3 times\)/)
  assert.equal((out.text.match(/Payment Failed And Shutdown Coming Soon/g) || []).length, 1)
  assert.match(out.text, /Review service billing notice — payment failed/, 'different items stay')
}
console.log('✓ repeated alerts and open items are merged into one line')

// ---- 22 Nov: Hinglish asks, and "are you ok?" as a check-in ------------------------------------------------------
{
  const HI = ['Tum theek se kaam kar rahe ho?', 'kya tum kaam kar rahe ho', 'Gogo chal raha hai?', 'aap theek se chal rahe ho?',
    'self diagnostic chalao', 'system check karo', 'Gogo, please system check kar do', 'khud ko check karo', 'apne systems check karo',
    'kya sab systems theek hai?', 'tumhare services chal rahe hain?', 'tum theek ho?', 'Gogo theek hai?', 'aap ok ho?']
  for (const t of HI) { assert.equal(d.classifyDiagnosticAsk(t), 'diagnostic', t); assert.ok(d.DIAGNOSTIC_GATE.test(t), 'gate: ' + t) }
  // Not about AskGogo: life, someone else, or an action with a time.
  const HI_NOT = ['sab theek hai?', 'sab theek hai', 'Divya theek hai?', 'mummy theek hai kya', 'kal system check karo', 'kal 10 baje system check yaad dilana',
    'car ka system check karo', 'Nithin ko call karo', 'tum theek ho? mujhe Divya ke baare mein batao', 'kya tum kal free ho?']
  for (const t of HI_NOT) assert.equal(d.classifyDiagnosticAsk(t), null, t)
  for (const t of ['Are you ok?', 'are you okay', 'Gogo, are you alright?', 'tum theek ho?', 'Gogo theek hai?']) assert.equal(d.isCasualCheckIn(t), true, t)
  for (const t of ['Are you working properly?', 'Run a self-diagnostic', 'system check karo', 'tum theek se kaam kar rahe ho?']) assert.equal(d.isCasualCheckIn(t), false, t)
  for (const t of ['is everything ok?', 'are you ok with this plan?', 'are you free tomorrow?']) assert.equal(d.classifyDiagnosticAsk(t), null, t)

  // The check-in reply: the headline, what needs a look, no alerts or open items, no queue read, no writes.
  const withQueue: Tables = { ...healthy,
    agent_activity: [{ telegram_id: OWNER, event_type: 'watcher_triggered', created_at: ago(5), message: 'Gold alert: 24K at ₹12,557/g' }],
    agent_open_loops: [{ telegram_id: OWNER, status: 'active', kind: 'followup', priority: 0.9, title: 'Swiggy Builders: no reply', due_at: null }],
  }
  const { db, writes } = fakeDb(withQueue)
  const ok = await d.trySystemDiagnostic(actor, 'Are you ok?', { db, now: NOW, env, ...probes })
  assert.equal(ok.readOnly, true); assert.equal(ok.mutated, false); assert.equal(ok.checks.length, 8)
  assert.match(ok.text, /^✅ Yes, all good\. 8 checks OK, checked just now\./)
  assert.doesNotMatch(ok.text, /Gold alert|Swiggy Builders|In the last 3 days|Still open/)
  assert.match(ok.text, /Reply \*self-diagnostic\* for the full check\. Nothing was sent or changed\.$/)
  assert.deepEqual(writes, [])
  const hi = await d.trySystemDiagnostic(actor, 'tum theek ho?', { db, now: NOW, env, ...probes })
  assert.match(hi.text, /^✅ Yes, all good\./)
  const long = await d.trySystemDiagnostic(actor, 'system check karo', { db, now: NOW, env, ...probes })
  assert.match(long.text, /^\*AskGogo self-diagnostic\*/); assert.match(long.text, /Gold alert/, 'a Hinglish self-check gets the summary')
  // A check-in with a problem names it.
  const sick = d.formatDiagnosticBrief([
    { key: 'm', label: 'Memory persistence', status: 'operational', evidence: 'x', at: null },
    { key: 'g', label: 'Gmail', status: 'blocked', evidence: 'Google refused the saved sign-in. Reconnect Gmail.', at: null },
    { key: 'w', label: 'Background watchers', status: 'unverified', evidence: 'x', at: null, quiet: true },
  ], NOW)
  assert.match(sick, /^⚠️ Mostly\. 1 OK, 1 needs a look:\n.*\*Gmail\*: .*Reconnect Gmail\./)
  assert.doesNotMatch(sick, /Background watchers/)
}
console.log('✓ Hinglish self-checks are recognised; "are you ok?" gets a short check-in reply')
