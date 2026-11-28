import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const { supabaseAdmin } = await import('../lib/supabase-admin')
const { pgliteSupabase } = await import('./lib/pglite-supabase.mts')
const { readDatedFacts, changeDatedFact, answerDatedQuestion, factDay, datedReminderText } = await import('../lib/memory/dated-facts')
const { tryLifeGraphTurn, frontDoorCandidate } = await import('../lib/memory/front-door')
const { askWorkspace } = await import('../lib/workspaces/ask')
const db = new PGlite()
const adapter = pgliteSupabase(db)
Object.assign(supabaseAdmin, { rpc: adapter.rpc, from: adapter.from })

const ws = randomUUID(), other = randomUUID()
const admin = '41', viewer = '42', exact = '9007199254740993'
const topic = 'Late checkout', sunday = '2026-11-29', monday = '2026-11-30'
const first = randomUUID(), second = randomUUID()
const save = (id: string, day: string, answer: string, head: string | null = null) => ({
  action: 'save', requestId: id, topic, day, answer, source: 'Front desk policy ' + day, head,
})
async function read(actor: string, wsId: string | null, day = monday) {
  return (await readDatedFacts(actor, wsId, topic, day))[0]
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid, telegram_id text, role text, primary key(workspace_id,telegram_id));
    grant select,update on workspace_members to service_role;`)
  const migration = 'supabase/migrations/20261128060000_dated_facts'
  await db.exec(readFileSync(migration + '.sql', 'utf8'))
  await db.query('insert into workspaces values ($1),($2)', [ws, other])
  await db.query("insert into workspace_members values ($1,$2,'admin'),($1,$3,'viewer'),($4,$2,'owner')", [ws, admin, viewer, other])
  await db.exec('set role service_role')
  await changeDatedFact(admin, ws, save(first, sunday, '2 pm'))
  const cutoff = (await read(admin,ws))!.revision!.recordedAt
  await changeDatedFact(admin, ws, save(second, monday, 'Noon', first))
  assert.equal((await read(viewer, ws, sunday)).revision?.answer, '2 pm')
  assert.equal((await read(viewer, ws, monday)).revision?.answer, 'Noon')
  const earlier = await adapter.rpc('read_dated_facts', {p_actor:viewer,p_workspace:ws,p_topic:'late checkout',p_day:monday,p_known_at:cutoff})
  assert.equal(earlier.data[0].revision.id,first,'knowledge cutoff excludes a revision learned later')
  await changeDatedFact(admin, ws, save(second, monday, 'Noon', first))
  await assert.rejects(changeDatedFact(admin,ws,save(randomUUID(),monday,'Stale',first)), /changed/)
  await assert.rejects(changeDatedFact(viewer,ws,save(randomUUID(),monday,'Wrong',second)), /role/)
  assert.equal(await read(admin,other),undefined)
  assert.equal(await read(admin,null),undefined)
  await changeDatedFact(exact,null,save(randomUUID(),sunday,'Personal note'))
  assert.equal(await read('9007199254740992',null),undefined)
  await assert.rejects(read('9e15',null),/identity/)

  // Both entry points use the same recorded revision, scoped to the authenticated viewer.
  await changeDatedFact(admin,null,save(randomUUID(),sunday,'My own stay'))
  assert.equal(frontDoorCandidate('Fact: late checkout on '+monday),true)
  const question = 'Fact: late checkout on '+monday
  const chat = await tryLifeGraphTurn({telegramId:41,text:question,surface:'whatsapp'})
  assert.match(chat!.text,/My own stay/); assert.doesNotMatch(chat!.text,/Noon/)
  const staff = await askWorkspace(viewer,ws,question)
  assert.equal(staff.answer,'Noon'); assert.ok(staff.source.label.includes(second))
  await changeDatedFact(viewer,ws,{action:'follow',topic,head:second})
  assert.equal((await readDatedFacts(viewer,ws,null,sunday))[0].revision?.answer,'2 pm')
  const reference = (await read(viewer,ws)).id
  const origin = 'https://example.invalid'
  assert.equal(await datedReminderText(viewer,reference,monday,origin), 'Review the current fact in your workspace brief: '+origin+'/dashboard/business?ws='+ws)
  assert.equal(await datedReminderText(admin,reference,monday,origin),null,'requires viewer subscription')
  const personal = await read(admin,null)
  await changeDatedFact(admin,null,{action:'follow',topic,head:personal.head})
  await changeDatedFact(admin,null,save(randomUUID(),monday,'My revised stay',personal.head))
  assert.match((await datedReminderText(admin,personal.id,monday,origin))!, /My revised stay/)
  assert.equal(await datedReminderText(viewer,personal.id,monday,origin),null)
  const exported = await db.query<{answer:string}>('select answer from dated_fact_export where telegram_id=$1',[admin])
  assert.deepEqual(exported.rows.map(row=>row.answer).sort(),['My own stay','My revised stay'])
  const correction = randomUUID()
  await changeDatedFact(admin,ws,save(correction,monday,'12:30 pm',second))
  assert.equal((await readDatedFacts(viewer,ws,null,monday))[0].revision?.answer,'12:30 pm')
  assert.deepEqual(await readDatedFacts(admin,ws,null,monday),[])
  await db.exec('reset role')
  await db.query('delete from workspace_members where workspace_id=$1 and telegram_id=$2',[ws,viewer])
  await db.exec('set role service_role')
  await assert.rejects(readDatedFacts(viewer,ws,null,monday), /role/)
  await assert.rejects(askWorkspace(viewer,ws,question), /forbidden/)
  assert.equal(await datedReminderText(viewer,reference,monday,origin),null)
  await changeDatedFact(admin,ws,{action:'forget',topic,head:correction})
  await assert.rejects(changeDatedFact(admin,ws,save(first,sunday,'2 pm')), /changed/)
  assert.equal(await read(admin,ws),undefined)
  assert.equal((await read(admin,null)).revision?.answer,'My revised stay')
  assert.throws(()=>factDay('2026-02-30'))
  assert.equal(await answerDatedQuestion(admin,null,'Book a room'),null)
  await db.exec('reset role; set role authenticated')
  await assert.rejects(db.query('select * from read_dated_facts($1,$2,$3,$4)',[admin,null,'late checkout',monday]), /permission denied/)
  await db.exec('reset role')
  await db.exec(readFileSync(migration + '.rollback.sql','utf8'))
  console.log('dated facts passed: both chat surfaces, effective and recorded time, source citations, scope, corrections, replay, revocation, saved briefs, erasure, grants and rollback')
} finally { await db.close() }
