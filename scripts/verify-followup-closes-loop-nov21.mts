// 21 Nov (handoff item): answering "handled" to a deadline follow-up was only recorded; the mail stayed in "what needs my
// attention?". It now closes that mail's Gmail open loop: exact owner, active only, matched on the judged message id.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const fu: any = await import('../lib/agent/follow-ups')
const O = '-9000000001', OTHER = '-9000000002'
const sentAt = Date.parse('2026-11-21T03:00:00Z'), t = sentAt + 120_000, iso = (ms: number) => new Date(ms).toISOString()

function mk(opts: { keys?: string[]; kind?: string; loops?: any[]; updateFails?: boolean; noUpdate?: boolean } = {}) {
  const activity = [{ id: 'f1', telegram_id: O, event_type: 'followup_sent', created_at: iso(sentAt), message: 'Twilio: I flagged yesterday’s mail “Recharge now” as time-sensitive. Has it been handled?', metadata_json: { kind: opts.kind || 'deadline', keys: opts.keys ?? ['deadline:19a2b3c4d5e6f7'] } }]
  const loops = opts.loops ?? [
    { id: 'L1', telegram_id: O, status: 'active', source_type: 'gmail_thread', evidence_json: { last_message_id: '19a2b3c4d5e6f7' } },
    { id: 'L2', telegram_id: OTHER, status: 'active', source_type: 'gmail_thread', evidence_json: { last_message_id: '19a2b3c4d5e6f7' } },
    { id: 'L3', telegram_id: O, status: 'active', source_type: 'gmail_thread', evidence_json: { last_message_id: 'zzzzzzzzzzzz' } },
    { id: 'L4', telegram_id: O, status: 'dismissed', source_type: 'gmail_thread', evidence_json: { last_message_id: '19a2b3c4d5e6f7' } },
    { id: 'L5', telegram_id: O, status: 'active', source_type: 'conversation', evidence_json: { last_message_id: '19a2b3c4d5e6f7' } },
  ]
  const updates: any[] = []
  const from = (table: string) => {
    let rows: any[] = table === 'agent_activity' ? activity : table === 'agent_open_loops' ? loops : []
    let patch: any = null
    const get = (r: any, k: string) => k === 'evidence_json->>last_message_id' ? r.evidence_json?.last_message_id : r[k]
    const o: any = {
      select: () => (patch ? Promise.resolve(opts.updateFails ? { data: null, error: { message: 'x' } } : (() => { for (const r of rows) Object.assign(r, patch); updates.push({ patch, ids: rows.map(r => r.id) }); return { data: rows.map(r => ({ id: r.id })), error: null } })()) : o),
      eq: (k: string, v: any) => { rows = rows.filter(r => String(get(r, k)) === String(v)); return o },
      in: (k: string, vs: string[]) => { rows = rows.filter(r => vs.includes(r[k])); return o },
      gte: (k: string, v: string) => { rows = rows.filter(r => r[k] >= v); return o },
      gt: (k: string, v: string) => { rows = rows.filter(r => r[k] > v); return o },
      order: () => o,
      limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
      insert: () => Promise.resolve({ error: null }),
      ...(opts.noUpdate ? {} : { update: (p: any) => { patch = p; return o } }),
    }
    return o
  }
  return { db: { from }, loops, updates }
}

{ const m = mk()
  assert.equal(await fu.handleFollowUpAnswer(O, 'Yes', m.db, t), "Good, that's sorted. I won't ask about the Twilio mail again. I have closed it in your open items.")
  assert.deepEqual(m.updates.map(u => u.ids), [['L1']], 'only this owner, active, Gmail thread, same message')
  assert.deepEqual(m.loops.map(l => [l.id, l.status]), [['L1', 'resolved'], ['L2', 'active'], ['L3', 'active'], ['L4', 'dismissed'], ['L5', 'active']])
  assert.equal(m.loops[0].resolved_at, iso(t)) }
console.log('✓ "handled" closes exactly that mail\'s open loop for this owner, and says so')

// Nothing to close, or a failed close: the answer is the same as before and nothing else changes.
for (const [label, m] of [['no matching loop', mk({ loops: [] })], ['update error', mk({ updateFails: true })], ['db without update', mk({ noUpdate: true })], ['malformed key', mk({ keys: ['deadline:../../x', 'mail:1'] })]] as const) {
  assert.equal(await fu.handleFollowUpAnswer(O, 'done', m.db, t), "Good, that's sorted. I won't ask about the Twilio mail again.", label)
  assert.ok(m.loops.every((l: any) => l.status !== 'resolved' || l.id !== 'L1' || label === 'no matching loop'), label)
}
// "Not yet" and the digest never close anything.
{ const m = mk(); assert.match(await fu.handleFollowUpAnswer(O, 'not yet', m.db, t), /still open on your side/); assert.equal(m.updates.length, 0) }
{ const m = mk({ kind: 'digest', keys: ['open_loop:L1'] }); assert.equal(await fu.handleFollowUpAnswer(O, 'yes', m.db, t), "Okay, I'll keep them on your list."); assert.equal(m.updates.length, 0) }
assert.equal(fu.followUpAnswerReply('deadline', 'handled', 'Twilio'), "Good, that's sorted. I won't ask about the Twilio mail again.")
console.log('✓ no loop, a failed close, "not yet" and the digest leave everything as it was')
