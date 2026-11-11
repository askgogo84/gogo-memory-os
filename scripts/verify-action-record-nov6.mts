// One shape for every consequential action (6 Nov): request → policy decision → execution → provider evidence →
// verification → the receipt line. Also proves the first two consumers (expense log, bill reminder from a shared SMS)
// end to end against an in-memory Supabase: the person sees "Done" only after the row is read back.
import assert from 'node:assert/strict'
const ar = await import('../lib/agent/action-record')

// 1. Policy → the four modes, decided deterministically.
const open = (policy: any) => ar.openActionRecord({ telegramId: 1, capability: policy.capability, action: 'x', request: 'r', policy, now: 1_000 })
assert.deepEqual([open({ capability: 'reminders', permissionLevel: 'auto', mode: 'execute', risk: 'low', irreversible: false }).decision.mode, open({ capability: 'reminders', permissionLevel: 'auto', mode: 'execute', risk: 'low', irreversible: false }).state], ['auto', 'planned'])
const needsApproval = open({ capability: 'email', permissionLevel: 'auto', mode: 'execute', risk: 'medium', irreversible: true })
assert.deepEqual([needsApproval.decision.mode, needsApproval.state], ['approval', 'awaiting_approval'], 'a consequential capability never auto-executes')
const approved = open({ capability: 'email', permissionLevel: 'ask', mode: 'execute', risk: 'medium', irreversible: true, approvalStatus: 'approved' })
assert.deepEqual([approved.decision.mode, approved.state], ['approval', 'planned'], 'an approved record is ready to run')
const recommend = open({ capability: 'calendar', permissionLevel: 'draft', mode: 'execute', risk: 'low', irreversible: false })
assert.deepEqual([recommend.decision.mode, recommend.state], ['recommend', 'blocked'])
const human = open({ capability: 'payments', permissionLevel: 'off', mode: 'execute', risk: 'high', irreversible: true })
assert.deepEqual([human.decision.mode, human.state], ['human_led', 'blocked'])
console.log('✓ auto / recommend / approval / human-led come from policy.ts, never from the model')

// 2. The state machine refuses shortcuts: no verified_success without verification, no life after a terminal state.
let rec = open({ capability: 'reminders', permissionLevel: 'auto', mode: 'execute', risk: 'low', irreversible: false })
assert.throws(() => ar.transition(rec, 'verified_success'), /illegal_transition:planned->verified_success/)
assert.throws(() => ar.attachEvidence(rec, { provider: 'x' }), /evidence_in_planned/)
rec = ar.transition(rec, 'running', { now: 2_000 })
rec = ar.attachEvidence(rec, { provider: 'supabase.reminders', ids: { id: '42' } }, 3_000)
assert.throws(() => ar.transition(rec, 'verified_success'), /illegal_transition:running->verified_success/, 'running cannot skip verifying')
const ok = ar.recordVerification(rec, { state: 'verified_completed', evidence: { id: '42' } }, 4_000)
assert.equal(ok.state, 'verified_success'); assert.deepEqual(ok.history.map(h => h.state), ['planned', 'running', 'verifying', 'verified_success'])
assert.throws(() => ar.transition(ok, 'running'), /illegal_transition:verified_success->running/)
const unknown = ar.recordVerification(rec, { state: 'still_unknown', evidence: {}, reason: 'calendar_reconcile_failed' }, 4_000)
assert.equal(unknown.state, 'outcome_unknown'); assert.equal(ar.mayRetry(unknown), false, 'never retry an unknown outcome')
const absent = ar.recordVerification(rec, { state: 'verified_absent', evidence: {} }, 4_000)
assert.equal(absent.state, 'failed'); assert.equal(ar.mayRetry(absent), true, 'verified absent may be retried once')
console.log('✓ planned → running → verifying → verified_success | failed | outcome_unknown; illegal moves throw; unknown never retries')

// 3. The receipt says what was verified, not what was attempted.
assert.equal(ar.receiptLine(ok, 'reminder for Wed, 11 Nov, 9:00 am'), 'Done: reminder for Wed, 11 Nov, 9:00 am.')
assert.match(ar.receiptLine(unknown, 'Reminder for Wed'), /^I tried to reminder for Wed, but couldn't confirm it went through\. I won't retry on my own/)
assert.equal(ar.receiptLine(absent, 'the reminder'), "That didn't go through: the reminder (verified absent). Nothing was changed.")
assert.match(ar.receiptLine(needsApproval, 'sending the email to Nithin'), /^Ready: sending the email to Nithin\. Reply "approve"/)
assert.match(ar.receiptLine(recommend, 'the calendar event'), /^I can prepare the calendar event for you to do yourself/)
assert.match(ar.receiptLine(human, 'the payment'), /needs you to do it; I'm not allowed to\.$/)
console.log('✓ receipt lines: Done / couldn\'t confirm / didn\'t go through / Ready / prepare / needs you')

// 4. First consumers: the shared-content "yes" for an expense and a bill reminder, against an in-memory DB.
// The fixture bill is due on 12 Nov 2026 and the reminder is for 11 Nov at 9:00 am. The clock is pinned to 7 Nov 2026
// (and still ticks), so this section tests the same thing on any day: from 11 Nov 9:00 am IST the real clock makes the
// reminder time "already passed" and the correct refusal failed this assertion in CI (11 Nov).
{ const RealDate = Date, started = RealDate.now(), PINNED = RealDate.parse('2026-11-07T06:00:00.000Z')
  const nowPinned = () => PINNED + (RealDate.now() - started)
  class PinnedDate extends RealDate { constructor(...a: any[]) { if (a.length === 0) super(nowPinned()); else super(...(a as [any])) } static now() { return nowPinned() } }
  ;(globalThis as any).Date = PinnedDate }
const rows: Record<string, any[]> = { agent_activity: [], conversations: [], expenses: [], reminders: [] }
let nextId = 100
function table(name: string) {
  const data = rows[name]
  const q: any = { _f: [] as [string, any][], _order: null, _limit: null, _select: '*' }
  const chain = (obj: any) => Object.assign(obj, {
    select(s: string) { obj._select = s; return obj }, eq(k: string, v: any) { obj._f.push([k, v]); return obj }, gte() { return obj }, order(k: string, o: any) { obj._order = [k, o?.ascending !== false]; return obj }, limit(n: number) { obj._limit = n; return obj },
    maybeSingle() { return Promise.resolve({ data: obj._rows()[0] || null, error: null }) }, single() { return Promise.resolve({ data: obj._rows()[0] || null, error: null }) },
    _rows() { const hit = data.filter((r: any) => obj._f.every(([k, v]: any) => String(r[k]) === String(v))); if (obj._order) hit.sort((a: any, b: any) => (a.id - b.id) * (obj._order[1] ? 1 : -1)); return hit.slice(0, obj._limit || undefined) },
    then(res: any) { return Promise.resolve({ data: obj._rows(), error: null }).then(res) },
    insert(row: any) { const r = { id: nextId++, created_at: new Date().toISOString(), ...row }; data.push(r); const o: any = { ...q, _f: [['id', r.id]] }; return chain(o) },
    update(patch: any) { const o: any = { ...q }; chain(o); const orig = o.eq; o.eq = (k: string, v: any) => { orig(k, v); o._rows().forEach((r: any) => Object.assign(r, patch)); return o }; return o },
  })
  return chain(q)
}
const fakeDb = { from: table }
const { supabaseAdmin } = await import('../lib/supabase-admin')
;(supabaseAdmin as any).from = table
{
  const sc = await import('../lib/agent/shared-content')
  const actor: any = { userId: 'u1', legacyTelegramId: 777, whatsappId: '919999999999', name: 'Gogo', timezone: 'Asia/Kolkata' }
  const DEBIT = 'Rs.2,450.00 debited from A/c XX6355 on 06-11-26 to SWIGGY via UPI. UPI Ref 631012345678. Not you? Call 18002586161 -HDFC Bank'
  const first = await sc.tryShared(777, DEBIT)
  assert.match(first!, /Want me to log it as an expense\?$/)
  rows.conversations.push({ id: nextId++, telegram_id: 777, role: 'assistant', content: first })
  const done = await sc.takeSharedOffer(actor, 'yes')
  assert.equal(done, 'Done: ₹2,450.00 logged as Swiggy. Say "expenses today" to see the day.', done!)
  assert.equal(rows.expenses.length, 1)
  const recs = await ar.recentActionRecords(fakeDb, 777)
  assert.equal(recs.length, 1); assert.deepEqual([recs[0].action, recs[0].state, recs[0].decision.mode, recs[0].evidence[0].provider, recs[0].verification?.state], ['expense.log', 'verified_success', 'auto', 'supabase.expenses', 'verified_completed'])
  assert.equal(await sc.takeSharedOffer(actor, 'yes'), null, 'a second yes does nothing: the offer is closed')

  const BILL = 'Dear Customer, your Airtel Fiber bill of Rs.1,199 is due on 12 Nov 2026. Pay now to avoid disconnection. Ignore if already paid. -Airtel'
  const second = await sc.tryShared(777, BILL)
  rows.conversations.push({ id: nextId++, telegram_id: 777, role: 'assistant', content: second })
  const remind = await sc.takeSharedOffer(actor, 'yes')
  assert.match(remind!, /^Done: reminder for Wed, 11 Nov, 9:00 am\. Airtel ₹1,199 is due on 12 Nov 2026\.$/, remind!)
  assert.equal(rows.reminders.length, 1); assert.equal(rows.reminders[0].remind_at, '2026-11-11T03:30:00.000Z')
  const recs2 = await ar.recentActionRecords(fakeDb, 777)
  assert.deepEqual(recs2.map(r => r.action).sort(), ['expense.log', 'reminder.create'])
  console.log('✓ expense log and bill reminder: row written, read back, action record saved, "Done" only then')
}
console.log('Action record (6 Nov) checks passed')
