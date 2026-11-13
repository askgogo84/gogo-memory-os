// Proactive comparison (13 Nov): for GOGO_PROACTIVE_SHADOW owners the email pulse, the meeting nudge and a daily
// list cleanup compute what they WOULD send and log it; nothing is claimed, sent, backed off or marked shown.
// Synthetic fixtures only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
const P = await import('../lib/email/proactive.ts')
const S = await import('../lib/agent/proactive-shadow.ts')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const NOW = Date.parse('2026-11-13T04:00:00Z'), H = 3600_000
const loop = (id: string, over: any = {}) => ({ id, kind: 'followup', title: over.title || `Divya — ${id}`, summary: over.summary || 'Please confirm', source_type: over.source_type || 'gmail_thread', source_id: over.source_id ?? `t-${id}`,
  evidence_json: { last_message_from: over.from ?? 'Divya <divya@example.com>', last_internal_date: over.at ?? NOW - 2 * H, ...over.ev }, created_at: new Date(NOW - 2 * H).toISOString(), ...over.loop })
const loops = [
  loop('a', { title: 'WeWork — Access deactivation: dues of ₹35,841.29 pending', summary: 'Your keycard access will be deactivated tomorrow at 3pm unless dues are settled', from: 'WeWork Billing <billing@wework.example>' }),
  loop('b', { title: 'Apify — Security incident affecting your account', summary: 'We detected unauthorized access to account data on Nov 9-10', from: 'Apify Security <security@apify.example>' }),
  loop('old', { at: NOW - 72 * H }),
  loop('fut', { at: NOW + 5 * H }),
  loop('wait', { loop: { kind: 'waiting_on' } }),
  loop('cal', { source_type: 'meeting_prep' }),
  loop('nosender', { from: '' }),
  loop('seen', {}),
  loop('dup1', { source_id: 'T', title: 'Divya — same thread' }), loop('dup2', { source_id: 'T', title: 'Divya — same thread again' }),
]
// Parity: selectProactiveEmails is exactly the picks of explainProactiveEmails, for many option sets.
for (const opts of [{ now: NOW }, { now: NOW, threshold: 0 }, { now: NOW, threshold: 0, sentToday: 1 }, { now: NOW, threshold: 0, sentToday: 2 }, { now: NOW, threshold: 0, cap: 5 }, { now: NOW, threshold: 0, alreadySurfaced: new Set(['email:t-seen']) }]) {
  const picks = P.explainProactiveEmails(loops as any, opts).filter(d => d.decision === 'pick').map(d => d.item!.loopId).sort()
  eq(picks, P.selectProactiveEmails(loops as any, opts).map(i => i.loopId).sort(), `select = explain picks for ${JSON.stringify({ ...opts, alreadySurfaced: undefined })}`)
}
{ const d = P.explainProactiveEmails(loops as any, { now: NOW, threshold: 0, cap: 10, alreadySurfaced: new Set(['email:t-seen']) })
  const why = Object.fromEntries(d.map(x => [x.loopId, x.reason]))
  eq(why.old, 'too_old', 'older than 48h: too_old'); eq(why.fut, 'future_dated', 'future-dated'); eq(why.wait, 'waiting_on_reply', 'waiting on my reply'); eq(why.cal, 'not_email', 'not an email loop')
  eq(why.nosender, 'no_sender', 'no sender'); eq(why.seen, 'already_surfaced', 'already surfaced')
  ok([why.dup1, why.dup2].includes('weaker_in_thread'), 'one email per thread; the weaker is explained')
  eq(d.length, loops.length, 'every loop gets exactly one decision') }
{ const d = P.explainProactiveEmails(loops as any, { now: NOW, threshold: 0, sentToday: 2 })
  ok(d.every(x => x.decision === 'skip') && d.some(x => x.reason === 'over_daily_cap'), 'at the daily cap: nothing picked, the cap is the reason') }
{ const d = P.explainProactiveEmails(loops as any, { now: NOW, threshold: 2 })
  ok(d.some(x => x.reason === 'below_threshold' && typeof x.score === 'number'), 'below the bar: logged with its score') }

// Owners: exact legacy ids only; negative allowed.
eq(S.proactiveShadowOwners({ GOGO_PROACTIVE_SHADOW: '-9000000001, 123,abc,1e5,,0,-0,9000000001' }), ['-9000000001', '123', '9000000001'], 'exact ids only')
eq(S.proactiveShadowOwners({}), [], 'off unless set')
// Logged text: secrets and account numbers masked, bounded.
ok(!/123456789012/.test(S.shadowText('Pay from account 123456789012 now')), 'a labelled account number is withheld')
ok(!/123456789012/.test(S.shadowText('ref 123456789012 attached')) && !/123456789012/.test(S.shadowText('Order 123456789012 shipped')), 'other long digit runs never appear in full')
ok(S.shadowText('x'.repeat(500), 50).length === 50, 'bounded')
{ const rows: any[] = []
  ok(await S.logProactiveShadow('-9000000001', 'email', { would_send: 'x' }, { insert: async r => { rows.push(r); return {} } }), 'a row is written')
  eq(rows[0].event_type, 'proactive_shadow', 'its own event type'); eq(rows[0].telegram_id, '-9000000001', 'for the exact owner'); eq(rows[0].metadata_json.mode, 'shadow_only_nothing_sent', 'marked shadow only')
  ok(!(await S.logProactiveShadow('-9000000001', 'email', {}, { insert: async () => ({ error: { message: 'x' } }) })), 'a failed write reports false') }

// Code shape: the shadow passes never send, claim, back off, mark shown or write a conversation; they run first.
const pulse = readFileSync(new URL('../lib/agent/autonomy-pulse.ts', import.meta.url), 'utf8')
const em = pulse.slice(pulse.indexOf('export async function runEmailShadow'), pulse.indexOf('export async function processAutonomyPulse'))
ok(em.length > 1000 && !/sendWhatsApp|claim_autonomy_email_card|finish_autonomy_email_card|proactive_backoff_until|email_attention_events|from\('conversations'\)|\.update\(|\.rpc\(/.test(em), 'email and cleanup shadow: no send, claim, backoff, shown record, conversation or update')
const proc = pulse.slice(pulse.indexOf('export async function processAutonomyPulse'))
ok(proc.indexOf('proactiveShadowOwners()') < proc.indexOf("mayVolunteer('check_in')"), 'the email shadow runs before the quiet return')
const nudge = readFileSync(new URL('../lib/agent/meeting-nudge.ts', import.meta.url), 'utf8')
const ms = nudge.slice(nudge.indexOf('export async function runMeetingNudgeShadow'), nudge.indexOf('export async function processMeetingNudges'))
ok(ms.length > 800 && !/sendWhatsApp|deliverNotification|recordCostEvent|\.update\(/.test(ms), 'meeting shadow: no send, delivery or cost record')
ok(/\.in\('telegram_id', owners\)/.test(ms) && /owners\.includes\(identity\.id\)/.test(ms), 'meeting shadow reads only the listed owners')
const pn = nudge.slice(nudge.indexOf('export async function processMeetingNudges'))
ok(pn.indexOf('runMeetingNudgeShadow') < pn.indexOf("mayVolunteer('meeting_nudge')"), 'the meeting shadow runs before the quiet return')
const helpers = readFileSync(new URL('../lib/agent/proactive-shadow.ts', import.meta.url), 'utf8')
ok(!/sendWhatsApp|deliverNotification/.test(helpers), 'the helpers module has no send path')
console.log(`PROACTIVE_SHADOW_OK ${checks} checks`)
