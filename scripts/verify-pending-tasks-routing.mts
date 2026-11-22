import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import { isMeetingSearchCommand } from '../lib/services/meeting-search'
import * as lifecycle from '../lib/agent/task-lifecycle'
import { partitionAttentionRuns } from '../lib/agent/attention-state'
import { summarizeActiveRunState } from '../lib/dashboard/run-state'

// ─────────────────────────────────────────────────────────────────────────────
// Repair regression for the 1-Oct "Show my pending tasks." → "no pending tasks"
// failure. The phrase fell through every matcher to the freeform LLM, whose
// context omits agent_runs and relevance-filters open-loops, so a PAUSED SBC→MYS
// train run + a travel-review open loop were never surfaced.
//
// The fix routes the phrase to the authoritative open-loops reader
// (handleOpenLoopQuery), which reads missions/approvals/follow-ups unfiltered.
// This test drives the REAL isOpenLoopQuery + handleOpenLoopQuery (transpiled and
// run with an in-memory Supabase fake) — it executes behavior, not source grep.
//
// NOTE the reader is NOT read-only: syncOpenLoopsForUser upserts mirrored loops
// and handleOpenLoopQuery inserts an activity row. This test asserts those writes
// occur (so the reader is never described as read-only).
// ─────────────────────────────────────────────────────────────────────────────

const ISO = '2026-10-01T05:10:00.000Z'

// ── In-memory Supabase fake ───────────────────────────────────────────────────
function makeDb(seed: Record<string, any[]>, failTables = new Set<string>()) {
  const store: Record<string, any[]> = {}
  for (const k of Object.keys(seed)) store[k] = seed[k].map((r) => ({ ...r }))
  const writes: Array<{ table: string; op: string }> = []
  let seq = 0
  const client = {
    store, writes,
    from(table: string) {
      if (!store[table]) store[table] = []
      const b: any = {
        _table: table, _op: 'select', _filters: [] as Array<[string, string, any]>, _insert: null as any, _update: null as any,
        select() { return b },
        eq(c: string, v: any) { b._filters.push(['eq', c, v]); return b },
        in(c: string, v: any[]) { b._filters.push(['in', c, v]); return b },
        order() { return b }, range() { return b }, limit() { return b }, not() { return b },
        gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b },
        insert(row: any) { b._op = 'insert'; b._insert = row; return b },
        update(obj: any) { b._op = 'update'; b._update = obj; return b },
        _match(row: any) {
          return b._filters.every(([kind, c, v]) =>
            kind === 'in' ? (v as any[]).map(String).includes(String(row[c])) : String(row[c]) === String(v))
        },
        _rows() { return (store[table] || []).filter((r: any) => b._match(r)) },
        _resolve() {
          if (failTables.has(table)) return { data: null, error: { message: `injected_${table}_failure` } }
          if (b._op === 'insert') {
            const row = { id: b._insert.id || `${table}-${++seq}`, ...b._insert }
            store[table].push(row); writes.push({ table, op: 'insert' })
            return { data: { id: row.id }, error: null }
          }
          if (b._op === 'update') {
            for (const r of b._rows()) Object.assign(r, b._update); writes.push({ table, op: 'update' })
            return { data: null, error: null }
          }
          return { data: b._rows(), error: null }
        },
        async single() { const r = b._resolve(); return b._op === 'insert' ? r : { data: (r.data || [])[0] ?? null, error: r.error } },
        async maybeSingle() { const r = b._resolve(); return b._op === 'insert' ? r : { data: (r.data || [])[0] ?? null, error: r.error } },
        then(resolve: any, reject: any) { return Promise.resolve(b._resolve()).then(resolve, reject) },
      }
      return b
    },
  }
  return client
}

let transpiled: string | null = null
function loadOpenLoops(db: any) {
  if (!transpiled) {
    const src = readFileSync(new URL('../lib/agent/open-loops.ts', import.meta.url), 'utf8')
    transpiled = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  }
  const mocks: Record<string, any> = {
    './task-lifecycle': lifecycle,
    'node:crypto': crypto,
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/security/google-token-crypto': { decryptGoogleToken: (v: string) => v },
    '@/lib/services/google-gmail': { fetchGmailAttentionThreads: async () => [], refreshGmailAccessToken: async () => null },
  }
  const exportsObj: any = {}
  runInNewContext(transpiled, {
    exports: exportsObj, module: { exports: exportsObj },
    require: (name: string) => mocks[name] ?? {},
    process: { env: {} }, Buffer, URL, URLSearchParams, console, crypto,
  })
  return exportsObj
}

const actor = (tg: number) => ({ userId: String(tg), legacyTelegramId: tg, whatsappId: `whatsapp:+${tg}`, name: 'Gogo' })

let failures = 0
const check = (name: string, cond: boolean) => { if (cond) console.log('  ok —', name); else { failures++; console.error('  FAIL —', name) } }

// ── 1. Pure routing: the phrase reaches the intended handler; others preserved ─
{
  const ol = loadOpenLoops(makeDb({}))
  check('"Show my pending tasks." → isOpenLoopQuery true', ol.isOpenLoopQuery('Show my pending tasks.') === true)
  check('"show my pending tasks" (no period) → true', ol.isOpenLoopQuery('show my pending tasks') === true)
  check('"list my pending tasks" → true', ol.isOpenLoopQuery('list my pending tasks') === true)
  check('"what are my pending tasks" → true', ol.isOpenLoopQuery('what are my pending tasks') === true)
  check('regression: "show my open loops" still true', ol.isOpenLoopQuery('show my open loops') === true)
  // Preserve meeting-search ownership of the bare phrase.
  check('"my pending tasks" NOT claimed by open-loops', ol.isOpenLoopQuery('my pending tasks') === false)
  check('"my pending tasks" still claimed by meeting-search', isMeetingSearchCommand('my pending tasks') === true)
  check('"show my pending tasks." NOT claimed by meeting-search', isMeetingSearchCommand('show my pending tasks.') === false)
  // Preserve explicit to-do-list matcher inputs (anchored ^(tasks?|my tasks?|show tasks?|to-?do list?)$).
  check('to-do "tasks" NOT stolen by open-loops', ol.isOpenLoopQuery('tasks') === false)
  check('to-do "show tasks" NOT stolen by open-loops', ol.isOpenLoopQuery('show tasks') === false)
  check('to-do "my tasks" NOT stolen by open-loops', ol.isOpenLoopQuery('my tasks') === false)
}

// Shared fixture: a PAUSED SBC->MYS train run (agent_runs) + a travel-review open
// loop (agent_open_loops) for user 100; a COMPLETED loop; and user 200's record.
function seed(): Record<string, any[]> {
  return {
    agent_runs: [
      { id: 'run-sbc', telegram_id: '100', status: 'paused', title: 'Train research: SBC to MYS',
        summary: 'Paused: waiting on IRCTC device handoff for Bengaluru (SBC) to Mysuru (MYS).',
        error: null, capability: 'travel', updated_at: ISO, started_at: ISO },
    ],
    agent_open_loops: [
      { id: 'loop-travel', telegram_id: '100', kind: 'other', status: 'active', title: 'Travel review: confirm Mysuru hotel dates',
        summary: 'Review the Mysuru trip plan.', priority: 0.7, source_type: 'conversation', source_id: 'c1', fingerprint: 'fp-travel', updated_at: ISO, last_seen_at: ISO },
      { id: 'loop-done', telegram_id: '100', kind: 'followup', status: 'resolved', title: 'Reply to Anil COMPLETED',
        summary: 'done', priority: 0.5, source_type: 'conversation', source_id: 'c2', fingerprint: 'fp-done', resolved_at: ISO, updated_at: ISO },
      { id: 'loop-userB', telegram_id: '200', kind: 'approval', status: 'active', title: 'User B private approval SECRET',
        summary: 'other user', priority: 1, source_type: 'conversation', source_id: 'c3', fingerprint: 'fp-b', updated_at: ISO, last_seen_at: ISO },
    ],
    users: [], user_consent_settings: [], followups: [], agent_approvals: [],
    life_event_actions: [], memories: [], conversations: [], agent_activity: [],
  }
}

// ── 2. Relevant pending/paused work appears even with NO lexical overlap ───────
{
  const db = makeDb(seed())
  const ol = loadOpenLoops(db)
  const res = await ol.handleOpenLoopQuery({ actor: actor(100), text: 'Show my pending tasks.' })
  check('handler returns a result (not null) for the phrase', !!res && res.handledBy === 'open-loops')
  const text: string = res?.text || ''
  check('paused SBC→MYS mission appears (no lexical overlap with query)', /SBC/.test(text) && /MYS/.test(text))
  check('travel-review open loop appears', /travel review/i.test(text))
  check('reply is labelled as attention/open-loops (not "all your tasks")', /open loops|needs your attention/i.test(text) && !/all (your|pending) tasks/i.test(text))
  // Reader performs synchronization WRITES during the "read" → not read-only.
  check('reader WRITES while answering (mirrored mission upserted)', db.writes.some((w: any) => w.table === 'agent_open_loops'))
}

// ── 3. Completed/closed work is NOT presented as pending ───────────────────────
{
  const db = makeDb(seed())
  const ol = loadOpenLoops(db)
  const res = await ol.handleOpenLoopQuery({ actor: actor(100), text: 'show my pending tasks' })
  check('resolved/completed loop excluded', !/Reply to Anil/i.test(res?.text || ''))
}

// ── 4. Another user's records never appear ─────────────────────────────────────
{
  const db = makeDb(seed())
  const ol = loadOpenLoops(db)
  const a = await ol.handleOpenLoopQuery({ actor: actor(100), text: 'show my pending tasks' })
  check("user 100 reply excludes user 200's record", !/User B private approval SECRET/i.test(a?.text || ''))
  const b = await ol.handleOpenLoopQuery({ actor: actor(200), text: 'show my pending tasks' })
  check('user 200 sees only their own record', /User B private approval SECRET/i.test(b?.text || '') && !/SBC/.test(b?.text || '') && !/travel review/i.test(b?.text || ''))
}

// ── 5. Lookup failure → error/unavailable, NOT "no tasks" ──────────────────────
{
  const db = makeDb(seed(), new Set(['agent_open_loops']))
  const ol = loadOpenLoops(db)
  await assert.rejects(
    () => ol.handleOpenLoopQuery({ actor: actor(100), text: 'show my pending tasks' }),
    /open_loop_list_failed|open_loop_active_read_failed/,
    'authoritative read failure must throw (surface an error), not return a "no open loops" success',
  )
  check('lookup failure propagates as an error (asserted via rejects above)', true)
}

// Oct-1 production: old closed handoffs, an explicitly superseded trip and
// questions extracted as commitments polluted the list. Exercise reconciliation,
// numbered closure and the same lifecycle interpretation used by the dashboard.
{
  const fixture = seed()
  const base = fixture.agent_runs[0]
  fixture.agent_runs.push(
    {...base,id:'closed-train',title:'CLOSED TRAIN',metadata_json:{state:'closed_stale',handoff:{takeoverUrl:'old'}}},
    {...base,id:'superseded-trip',title:'SUPERSEDED TRIP',summary:'Superseded by duplicate mission submission'},
    {...base,id:'other-leg',title:base.title,summary:'Different rail request, waiting on your route choice.'},
  )
  const question='Which of those are actually running in the background right now, and which are just waiting for me?'
  fixture.agent_open_loops.push({id:'invented',telegram_id:'100',kind:'waiting_on',status:'active',title:'Waiting on me',summary:question,source_type:'conversation'})
  const db=makeDb(fixture)
  const ol=loadOpenLoops(db)
  assert.equal(ol.parseExplicitOpenLoop(question),null)
  assert.equal(ol.parseExplicitOpenLoop('How many reminders do I have to review Project Phoenix?'),null)
  assert.ok(ol.parseExplicitOpenLoop('I am waiting for Ravi to send the invoice.'))
  assert.equal(await ol.captureJevOpenLoopFromTurn({actor:actor(100),text:question,jev:{ok:true,attentionState:{choice:'waiting_on',confidence:1}}}),null)
  const first=await ol.handleOpenLoopQuery({actor:actor(100),text:'show my pending tasks'})
  assert.doesNotMatch(first.text,/CLOSED TRAIN|SUPERSEDED TRIP|Waiting on me/)
  assert.match(first.text,/Paused — not running/)
  assert.match(first.text,/waiting on IRCTC device handoff/)
  assert.match(first.text,/Source updated 01\/10\/2026/)
  assert.equal((first.text.match(/Train research: SBC to MYS/g)||[]).length,2,'same title must not hide a distinct source task')
  const runs=fixture.agent_runs
  assert.equal(partitionAttentionRuns(runs).waitingContext.length,2)
  assert.equal(summarizeActiveRunState([runs[1]]).waiting,0,'closed handoff is not actionable on dashboard')

  // Dismissal hides the attention item, does not claim verified task completion,
  // and an unchanged source cannot resurrect it during the next synchronization.
  const shown=db.store.agent_activity.find((r:any)=>r.event_type==='open_loops_list_shown').metadata_json.open_loop_ids
  const mirror=db.store.agent_open_loops.find((r:any)=>r.source_id==='run-sbc')
  const index=shown.indexOf(mirror.id)+1
  const refused=await ol.handleOpenLoopResolution({actor:actor(100),text:`mark ${index} done`})
  assert.match(refused.text,/underlying task is still active/)
  const dismissed=await ol.handleOpenLoopResolution({actor:actor(100),text:`dismiss ${index}`})
  assert.match(dismissed.text,/Closed/)
  await ol.handleOpenLoopQuery({actor:actor(100),text:'show my pending tasks'})
  assert.equal(mirror.status,'dismissed')
  assert.equal(db.store.agent_runs[0].status,'paused')

  // Explicit source closure reconciles its mirror, without changing the source.
  db.store.agent_runs.find((r:any)=>r.id==='other-leg').metadata_json={state:'closed_stale'}
  const after=await ol.handleOpenLoopQuery({actor:actor(100),text:'show my pending tasks'})
  assert.doesNotMatch(after.text,/Train research: SBC to MYS/)
  assert.equal(db.store.agent_open_loops.find((r:any)=>r.source_id==='other-leg').status,'resolved')
  check('source lifecycle, corrections, same-title identity and durable dismissal verified',true)
}

if (failures > 0) { console.error(`\npending-tasks routing verification FAILED: ${failures} check(s)`); process.exit(1) }
console.log('\npending-tasks routing verification passed')
