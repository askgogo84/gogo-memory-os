// 14 Nov follow-ups (owner: "build follow-ups in shadow" + "build follow-ups live for me only").
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as fu from '../lib/agent/follow-ups.ts'

let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const DAY = 86_400_000
const now = Date.parse('2026-11-14T06:00:00Z') // 11:30 IST
const tz = 'Asia/Kolkata'

// Owners and hours.
eq(fu.followupsLiveOwners({ GOGO_FOLLOWUPS_LIVE: '-884501501, abc, 12, -0' }), ['-884501501', '12'], 'live owners: exact ids only')
eq(fu.followupOwners({ GOGO_PROACTIVE_SHADOW: '-884501501,7', GOGO_FOLLOWUPS_LIVE: '-884501501' }).sort(), ['-884501501', '7'], 'shadow ∪ live, deduped')
ok(fu.inFollowupHours(now, tz) && !fu.inFollowupHours(Date.parse('2026-11-13T17:00:00Z'), tz) && !fu.inFollowupHours(Date.parse('2026-11-14T02:00:00Z'), tz), '8 am to 10 pm only (22:30 and 07:30 refused)')
ok(fu.followupClaimId('-1', '2026-11-14', 1) !== fu.followupClaimId('-1', '2026-11-14', 2) && /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(fu.followupClaimId('-1', '2026-11-14', 1)), 'claim ids: uuid-shaped, one per slot')

// Deadline: earlier day, no newer mail, built from checked fields.
eq(fu.senderName('WeWork India <billing@wework.co.in>'), 'WeWork India', 'sender display name')
eq(fu.senderName('billing@wework.com'), 'Wework', 'bare address → domain name')
eq(fu.senderName('team@mail.wework.co.in'), 'Wework', 'multi-part domain → the brand label')
eq(fu.senderName('<a@b.com>'), 'B', 'angle-only address → its domain')
const dl = (o: Partial<fu.DeadlineItem>): fu.DeadlineItem => ({ key: 'deadline:m1', sender: 'WeWork India <billing@wework.co.in>', subject: 'Dues pending: keycards deactivate tomorrow', judgedAt: now - DAY, newerMail: false, ...o })
const d = fu.buildDeadline([dl({})], new Set(), now, tz)!
eq(d.text, 'WeWork India: I flagged yesterday’s mail “Dues pending: keycards deactivate tomorrow” as time-sensitive. I see no newer mail from them since. Has it been handled?', 'deadline line: sender + subject; the flag is worded as Gogo’s, not as a fact')
eq(fu.buildDeadline([dl({ newerMail: true })], new Set(), now, tz), null, 'newer mail from them: no follow-up')
eq(fu.buildDeadline([dl({ newerMail: null })], new Set(), now, tz), null, 'unknown inbox state: no follow-up')
eq(fu.buildDeadline([dl({ judgedAt: now - 3600_000 })], new Set(), now, tz), null, 'flagged today: the judge already covers today')
eq(fu.buildDeadline([dl({ judgedAt: now - 4 * DAY })], new Set(), now, tz), null, 'older than 3 days: dropped')
eq(fu.buildDeadline([dl({})], new Set(['deadline:m1']), now, tz), null, 'never repeated')

// Event step.
const ev = fu.buildEvent([{ key: 'event:e1:draft_unpublished:r2', title: "Divya's anniversary", why: 'It is in 8 days and still a draft, so there is no invitation link yet. Publish it when the details are right.', href: '/dashboard/events/e1' }], new Set(), 'https://app.askgogo.in')!
eq(ev.text, "Divya's anniversary: It is in 8 days and still a draft, so there is no invitation link yet. Publish it when the details are right.\nOpen: https://app.askgogo.in/dashboard/events/e1", 'event line from the event’s own fields + link')
ok(!/https?:/.test(ev.label), 'template label has no link')
eq(fu.buildEvent([{ key: 'k', title: 'X', why: 'y', href: 'https://evil.example/x' }], new Set(), 'https://app.askgogo.in')!.text, 'X: y', 'a non-dashboard href is never linked')

// Digest: what the person asked for, stale 2+ days, not asked in 7 days.
const loop = (id: string, o: any = {}) => ({ id, kind: 'commitment', title: `Task ${id}`, summary: '', priority: 0.7, source_type: 'conversation', source_id: id, evidence_json: {}, last_seen_at: new Date(now - 3 * DAY).toISOString(), ...o })
const dg = fu.buildDigest([loop('a', { priority: 0.9, title: "Nithin's farewell: headcount and budget" }), loop('b', { title: 'Goa flights: refresh the cheapest option' }), loop('c', { last_seen_at: new Date(now - DAY).toISOString() }), loop('d', { source_type: 'gmail_thread' }), loop('e', { kind: 'approval' }), loop('f', { title: 'pending' })], new Set(['open_loop:x']), now)!
eq(dg.keys, ['open_loop:a', 'open_loop:b'], 'only stale, own, non-approval, named items; priority order')
eq(dg.text, "Still want these moving?\n• Nithin's farewell: headcount and budget\n• Goa flights: refresh the cheapest option\n\nAsk *what needs my attention?* to drop or finish any of them.", 'digest has no numbers, so a late "mark 2 done" can never tick the wrong thing')
ok(!/\b(?:dismiss|mark)\s+\d/i.test(dg.text + dg.label), 'no numbered commands in the digest or its template label')
eq(fu.buildDigest([loop('j', { evidence_json: { jev_attention_state: 'needs_followup' } })], new Set(), now), null, 'a loop Gogo inferred from chat is never presented as something the person asked for')
eq(fu.buildDigest([loop('a')], new Set(['open_loop:a']), now), null, 'an item asked about in the last 7 days is not repeated')
ok(fu.buildDigest(Array.from({ length: 9 }, (_, i) => loop(String(i))), new Set(), now)!.keys.length === fu.DIGEST_MAX, 'at most 4 items')
ok(fu.buildDigest([loop('a')], new Set(), now)!.label.length <= 400, 'template label fits')

// Priority: deadline > event > digest (digest once a day).
eq(fu.pickFollowUp({ deadline: d, event: ev, digest: dg }, false)?.kind, 'deadline', 'deadline first')
eq(fu.pickFollowUp({ deadline: null, event: ev, digest: dg }, false)?.kind, 'event', 'then event')
eq(fu.pickFollowUp({ deadline: null, event: null, digest: dg }, true), null, 'digest at most once a day')

// Commands.
eq(['stop follow-ups', 'Stop followups.', 'pause follow ups', 'turn off follow-ups'].map(fu.parseFollowUpCommand), ['stop', 'stop', 'stop', 'stop'], 'stop phrasings')
eq(['start follow-ups', 'resume follow ups'].map(fu.parseFollowUpCommand), ['start', 'start'], 'start phrasings')
eq(['stop', 'follow up with Divya', 'stop the follow up reminder for Nithin'].map(fu.parseFollowUpCommand), [null, null, null], 'nothing else is taken as the command')

// Pass with fakes: shadow vs live, cap, claim, stop, outside hours.
function fakeDb(state: any) {
  return { from(table: string) {
    const f: Array<(r: any) => boolean> = []
    let insertRow: any = null
    const q: any = {
      select() { return q }, order() { return q }, limit() { return q }, gte(k: string, v: string) { f.push(r => String(r[k] || '') >= v); return q },
      eq(k: string, v: any) { f.push(r => (k === 'metadata_json->>kind' ? r.metadata_json?.kind : r[k]) === v); return q },
      in(k: string, vs: any[]) { f.push(r => vs.includes(r[k])); return q },
      insert(row: any) { insertRow = row; return q },
      async maybeSingle() { return { data: (state[table] || []).find((r: any) => f.every(p => p(r))) || null, error: null } },
      then(a: any, b: any) {
        if (insertRow) {
          if (state.failInsert) return Promise.resolve({ error: { code: 'XX', message: 'x' } }).then(a, b)
          const rows = state[table] = state[table] || []
          if (insertRow.id && rows.some((r: any) => r.id === insertRow.id)) return Promise.resolve({ error: { code: '23505' } }).then(a, b)
          rows.push({ created_at: new Date(state.now ?? Date.now()).toISOString(), ...insertRow }); return Promise.resolve({ error: null }).then(a, b)
        }
        return Promise.resolve({ data: (state[table] || []).filter((r: any) => f.every(p => p(r))).sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at))), error: null }).then(a, b)
      } }
    return q
  } }
}
const base = () => ({ now, users: [{ telegram_id: -884501501, whatsapp_id: '918884501501', timezone: tz, access_status: 'active' }], agent_open_loops: [loop('a', { telegram_id: '-884501501', status: 'active' })], agent_activity: [] as any[] })
const sends: any[] = []
const logs: any[] = []
const deps = (state: any, env: any) => ({ now: () => state.now, env, db: fakeDb(state), events: async () => [], newerMail: async () => false, quiet: async () => false, session: async () => true, shadowHistory: async () => [], log: async (_o: string, m: any) => { logs.push(m); return true }, send: async (to: string, text: string) => { sends.push({ to, text }); return { sid: 'SM' + sends.length } } })

const src = readFileSync('lib/agent/follow-ups.ts', 'utf8')
ok(/if \(!live\) \{\s*const logged = await \(deps\.log \|\| \(\(id, meta\) => logProactiveShadow\(id, 'followup', meta\)\)\)/.test(src), 'shadow owners only log; nothing is sent')
ok(src.indexOf("await followupsStopped(owner, db)") < src.indexOf('followupClaimId(owner, today, slot)'), 'stop is checked before any claim or send')
ok(src.indexOf("event_type: 'followup_sent'") < src.indexOf('(deps.send || defaultSend)('), 'record first, then send (a crash can only skip, never send twice)')
ok(/if \(error\) return true\s*\n\s*return data\?\.\[0\]\?\.event_type === 'followups_stopped'/.test(src), 'unreadable stop state counts as stopped')
ok(/session \? wa\.sendWhatsApp\(to, text\) : wa\.sendWhatsAppReminderTemplate\(to, label\)/.test(src), 'outside the 24-hour window the approved reminder template is used')
ok(!/anthropic|messages\.create|openai/i.test(src), 'no model call: every line is a template of checked fields')
ok(/sentToday >= FOLLOWUP_DAILY_CAP/.test(src) && fu.FOLLOWUP_DAILY_CAP === 2, 'at most 2 a day')

// Stopped state with fake db.
eq(await fu.followupsStopped('-1', fakeDb({ agent_activity: [{ telegram_id: '-1', event_type: 'followups_started', created_at: '2026-11-13T00:00:00Z' }, { telegram_id: '-1', event_type: 'followups_stopped', created_at: '2026-11-14T00:00:00Z' }] })), true, 'latest command wins: stopped')
eq(await fu.followupsStopped('-1', fakeDb({ agent_activity: [] })), false, 'no command: on (for live owners only)')
eq(await fu.handleFollowUpCommand('-1', 'stop follow-ups', fakeDb({ agent_activity: [] })), 'Follow-ups are off. Your reminders and watches keep running. Say *start follow-ups* to turn them back on.', 'stop reply')
ok(/could not save/.test(String(await fu.handleFollowUpCommand('-1', 'stop follow-ups', fakeDb({ agent_activity: [], failInsert: true })))), 'a failed stop says so; never claims it is off')

// Outside hours: nothing happens.
const night = { ...base(), now: Date.parse('2026-11-13T17:30:00Z') }
eq((await fu.runFollowUps('-884501501', deps(night, { GOGO_FOLLOWUPS_LIVE: '-884501501' }) as any)).reason, 'outside_hours', 'no follow-up at night')
eq(sends.length, 0, 'nothing sent at night')

// Live pass for the allowlisted owner: digest sent once, recorded first; second pass sends nothing.
const day = base()
const live = { GOGO_FOLLOWUPS_LIVE: '-884501501', GOGO_PROACTIVE_SHADOW: '-884501501' }
const r1: any = await fu.runFollowUps('-884501501', deps(day, live) as any)
eq([r1.mode, r1.kind, sends.length, sends[0]?.to], ['live', 'digest', 1, '918884501501'], 'live owner gets the digest on WhatsApp')
ok(day.agent_activity.some((r: any) => r.event_type === 'followup_sent' && r.metadata_json.slot === 1) && !day.agent_activity.some((r: any) => r.event_type === 'open_loops_list_shown'), 'claim recorded; no number binding written')
const r2: any = await fu.runFollowUps('-884501501', deps(day, live) as any)
eq([r2.reason, sends.length], ['nothing_due', 1], 'same day: the digest is not repeated')
// Cap: two already sent today → nothing, even with a deadline due.
const capped = base(); capped.agent_activity.push(...[1, 2].map(n => ({ id: 'x' + n, telegram_id: '-884501501', event_type: 'followup_sent', created_at: new Date(now - n * 3600_000).toISOString(), metadata_json: { kind: 'event', keys: ['event:' + n] } })))
eq((await fu.runFollowUps('-884501501', deps(capped, live) as any) as any).reason, 'daily_cap', 'never more than 2 a day')
// Stopped: nothing claimed or sent.
const stopped = base(); stopped.agent_activity.push({ telegram_id: '-884501501', event_type: 'followups_stopped', created_at: new Date(now - 3600_000).toISOString() })
const before = sends.length
eq([(await fu.runFollowUps('-884501501', deps(stopped, live) as any) as any).reason, sends.length - before], ['stopped', 0], 'stop follow-ups is respected')
ok(!stopped.agent_activity.some((r: any) => r.event_type === 'followup_sent'), 'stopped: no claim row')
// Shadow-only owner: logged, never sent.
const sh = base(); const beforeShadow = sends.length
const rs: any = await fu.runFollowUps('-884501501', deps(sh, { GOGO_PROACTIVE_SHADOW: '-884501501' }) as any)
eq([rs.mode, sends.length - beforeShadow, logs.at(-1)?.follow_up], ['shadow', 0, 'digest'], 'shadow owner: logged, nothing sent')
ok(!sh.agent_activity.some((r: any) => r.event_type === 'followup_sent'), 'shadow: no claim row')
// Send failure: claim stays (never retried), reported as outcome unknown.
const boom = base()
const rb: any = await fu.runFollowUps('-884501501', { ...deps(boom, live), send: async () => { throw new Error('timeout') } } as any)
eq(rb.reason, 'outcome_unknown', 'a failed send is outcome unknown')
eq((await fu.runFollowUps('-884501501', { ...deps(boom, live), send: async () => { throw new Error('x') } } as any) as any).reason, 'nothing_due', 'and is never sent again')

// Deadline from a real judge row shape (id, from_addr from lib/agent/email-judge-shadow.ts).
const dlState = base()
dlState.agent_activity.push({ telegram_id: '-884501501', event_type: 'proactive_shadow', created_at: new Date(now - 20 * 3600_000).toISOString(), metadata_json: { kind: 'email_judge', verdicts: [
  { id: 'm-wework', from_addr: 'billing@wework.co.in', sender: 'WeWork India <billing@wework.co.in>', subject: 'Keycards deactivate tomorrow unless dues are paid', important: true, kind: 'cutoff', phishing: false },
  { id: 'm-scam', from_addr: 'kyc@bank-update.co', sender: 'Bank', subject: 'KYC', important: false, kind: 'none', phishing: true } ] } })
const seenSenders: string[] = []
const rd: any = await fu.runFollowUps('-884501501', { ...deps(dlState, live), newerMail: async (_o: string, s: string) => { seenSenders.push(s); return false } } as any)
eq([rd.kind, seenSenders], ['deadline', ['billing@wework.co.in']], 'judge row → next-day deadline re-check, only for the important cutoff mail')
ok(/^WeWork India: I flagged yesterday’s mail “Keycards deactivate tomorrow unless dues are paid” as time-sensitive\./.test(sends.at(-1).text), 'deadline line sent from checked fields')
const judgeSrc = readFileSync('lib/agent/email-judge-shadow.ts', 'utf8')
ok(/return \{ id: e\.id, from_addr:/.test(judgeSrc), 'the judge records the message id and sender address the re-check needs')
ok(pulse_ok(), 'follow-ups run before the shadow-only passes')
function pulse_ok() { const p = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8'); return p.indexOf('m.processFollowUps()') > 0 && p.indexOf('m.processFollowUps()') < p.indexOf('for(const owner of proactiveShadowOwners())') }

// Review fixes: quiet hours, recent chat list, overlapping passes, unconfirmed send, other mailbox, wording.
const qs = base()
eq((await fu.runFollowUps('-884501501', { ...deps(qs, live), quiet: async () => true } as any) as any).reason, 'quiet_hours', 'the person’s own quiet hours win')
const ov = base(); ov.agent_activity.push({ id: fu.followupClaimId('-884501501', '2026-11-14', 1), telegram_id: '-884501501', event_type: 'other', created_at: new Date(now).toISOString(), metadata_json: {} })
const ovBefore = sends.length
eq([(await fu.runFollowUps('-884501501', deps(ov, live) as any) as any).reason, sends.length - ovBefore], ['claimed_elsewhere', 0], 'slot taken by an overlapping pass: stop, never try the next slot with the same item')
const un = base()
eq((await fu.runFollowUps('-884501501', { ...deps(un, live), send: async () => ({}) } as any) as any).reason, 'outcome_unknown', 'no sid: outcome unknown')
const fuSrc = readFileSync('lib/agent/follow-ups.ts', 'utf8')
ok(/if \(!mailbox \|\| String\(access\.ownEmail \|\| ''\)\.toLowerCase\(\) !== mailbox\.toLowerCase\(\)\) return null/.test(fuSrc), 'a mail judged in another mailbox is never re-checked against the primary inbox')
ok(/if \(out\.length >= 3\) break\n    \}\n    if \(out\.length >= 3\) break/.test(fuSrc), 'at most 3 deadline items (both loops)')
const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
ok(/parseRunCancel\(text\) \|\| \/\^\\s\*\(\?:stop\|pause\|turn off\|no more\|start\|resume\|turn on\)\\s\+follow\[\\s-\]\?ups\?\[\.!\]\*\\s\*\$\/i\.test\(String\(text \|\| ''\)\)\) \{/.test(route), 'the webhook gives "stop follow-ups" first refusal, so it reaches the bridge handler')
ok(/followupsLiveOwners\(\)\.filter\(o=>!shadowSet\.has\(o\)\)/.test(pulse_src()), 'live owners also get judge rows for the re-check')
function pulse_src() { return readFileSync('lib/agent/autonomy-pulse.ts', 'utf8') }

// Wiring.
const bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
ok(bridge.indexOf("m.handleFollowUpCommand(String(actor.legacyTelegramId),params.text)") > 0 && bridge.indexOf("m.handleFollowUpCommand(String(actor.legacyTelegramId),params.text)") < bridge.indexOf('shouldHandleOpenLoopAction({actor'), 'stop/start command is routed before open-loop actions')
{ const gate = new RegExp(String(bridge.match(/const followUpCmd=\/(.+?)\/i\.test/)?.[1] || 'x^'), 'i')
  ok(['stop follow-ups', 'Resume follow ups!', 'turn off followups'].every(t => gate.test(t)) && !['follow up with Divya', 'stop the follow up reminder'].some(t => gate.test(t)), 'bridge gate matches the parser’s phrasings only') }
const pulse = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8')
ok(pulse.indexOf("m.processFollowUps()") > 0 && pulse.indexOf("m.processFollowUps()") < pulse.indexOf("mayVolunteer('check_in')"), 'follow-ups run before the quiet-rule return (live only for allowlisted owners)')
const loops = readFileSync('lib/agent/open-loops.ts', 'utf8')
ok(/const cutoff=new Date\(Date\.now\(\)-10\*60_000\)\.toISOString\(\)/.test(loops) && !/24\*3600_000/.test(loops.slice(loops.indexOf('async function recentOpenLoopListSnapshot'), loops.indexOf('async function recentOpenLoopListSnapshot') + 900)), 'numbers bind for the normal 10 minutes only (no 24 h digest binding)')

console.log(`PASS verify-follow-ups-nov14: ${checks} checks`)
