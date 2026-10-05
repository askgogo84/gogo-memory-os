import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import { isActionablePause, summarizeActiveRunState } from '../lib/dashboard/run-state'

// Production incident: a Blinkit run that ended blocked (status 'paused') still showed
// "Working" on the dashboard. Paused / waiting_approval runs are waiting on the user,
// not working; only running / queued runs are actively working.

assert.deepEqual(summarizeActiveRunState([{ status: 'running' }]).label, 'Working')
assert.deepEqual(summarizeActiveRunState([{ status: 'queued' }]).label, 'Working')

// The exact incident: a paused (provider-blocked) run must NOT read as "Working".
// A bare/rejected paused run is neither Working nor a standing "Waiting for you" prompt.
const blocked = summarizeActiveRunState([{ status: 'paused' }])
assert.notEqual(blocked.label, 'Working')
assert.equal(blocked.working, 0)
assert.equal(blocked.waiting, 0)

// A rejected-approval paused run must NOT linger as "Waiting for you".
assert.equal(summarizeActiveRunState([{ status: 'paused', error: 'approval_rejected' }]).label, 'Ready')

// An explicit approval wait is the one unambiguous "waiting on the user" state.
assert.equal(summarizeActiveRunState([{ status: 'waiting_approval' }]).label, 'Waiting for you')

// A paused run stopped at a human-action boundary (sign-in / secure handoff) IS
// actionable and must read "Waiting for you", not "Ready".
assert.equal(summarizeActiveRunState([{ status: 'paused', error: 'human_auth_required' }]).label, 'Waiting for you')
assert.equal(summarizeActiveRunState([{ status: 'paused', metadata_json: { handoff: { releaseUrl: 'x' } } }]).label, 'Waiting for you')
// Secure-browser-waiting handoffs signal via metadata (error cleared) — still actionable.
assert.equal(summarizeActiveRunState([{ status: 'paused', error: null, metadata_json: { browser_waiting: true, auth_resume: { kind: 'flight_execute' } } }]).label, 'Waiting for you')

// Terminal states are neither working nor waiting.
assert.equal(summarizeActiveRunState([{ status: 'completed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([{ status: 'failed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([]).label, 'Ready')
assert.equal(summarizeActiveRunState(null).label, 'Ready')

// A genuinely-running run reads as Working even alongside a paused one.
const mixed = summarizeActiveRunState([{ status: 'paused' }, { status: 'running' }])
assert.equal(mixed.label, 'Working')
assert.equal(mixed.working, 1)

// A running run must win over more-recent waiting_approval rows (home must not report
// "Waiting" while execution is active).
const runningPlusApprovals = summarizeActiveRunState([
  { status: 'waiting_approval' }, { status: 'waiting_approval' }, { status: 'running' },
])
assert.equal(runningPlusApprovals.label, 'Working')

// The 4 Oct Zepto delivery-location takeover was an actionable paused browser
// run, but Needs you showed zero approvals. Fetch handoffs before limiting rows
// so newer unrelated pauses cannot bury that same-task action.
const rows:any[]=[
  {id:'zepto',telegram_id:'42',type:'secure_browser',status:'paused',title:'Check Zepto',summary:'Select your delivery location.',error:'delivery_location_required',updated_at:'2026-10-04T15:10:00Z',metadata_json:{handoff:{takeoverUrl:'private-token'}}},
  {id:'other-owner',telegram_id:'43',type:'secure_browser',status:'paused',title:'Private task',updated_at:'2026-10-05T00:00:00Z',metadata_json:{handoff:{takeoverUrl:'foreign'}}},
  {id:'finished',telegram_id:'42',type:'secure_browser',status:'completed',title:'Finished task',updated_at:'2026-10-05T00:00:00Z',metadata_json:{handoff:{takeoverUrl:'old'}}},
  {id:'closed',telegram_id:'42',type:'secure_browser',status:'paused',title:'Closed task',updated_at:'2026-10-05T00:00:00Z',metadata_json:{state:'closed_stale',handoff:{takeoverUrl:'stale'}}},
]
for(let i=0;i<45;i++)rows.push({id:`unrelated-${i}`,telegram_id:'42',type:'secure_browser',status:'paused',updated_at:`2026-10-05T00:${String(i).padStart(2,'0')}:00Z`,metadata_json:{}})
rows.push(rows.shift()) // Keep the real handoff older than more than one page of unrelated pauses.
const selected:Array<[string,string,unknown]>=[]
const db={from(table:string){
  assert.equal(table,'agent_runs')
  const filters:Array<(row:any)=>boolean>=[]
  let limit=Infinity
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{selected.push(['eq',key,value]);filters.push(row=>row[key]===value);return q},
    not:(key:string,operator:string,value:unknown)=>{selected.push(['not',key,value]);assert.equal(operator,'is');filters.push(row=>key==='metadata_json->handoff'&&row.metadata_json?.handoff!=null);return q},
    order:()=>q,limit:(count:number)=>{limit=count;return q},
    then:(resolve:any)=>Promise.resolve({data:rows.filter(row=>filters.every(filter=>filter(row))).slice(0,limit),error:null}).then(resolve)}
  return q
}}
const handoffExports:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/dashboard/human-handoffs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:handoffExports,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='./run-state'?{isActionablePause}:null,
})
const handoffs=await handoffExports.getPendingBrowserHandoffs('42')
assert.deepEqual(handoffs.map((row:any)=>row.id),['zepto'])
assert.equal(handoffs[0].summary,'Select your delivery location.')
assert.doesNotMatch(JSON.stringify(handoffs),/private-token|foreign/,'Needs you exposes task links, not takeover tokens')
assert.ok(selected.some(([op,key,value])=>op==='eq'&&key==='telegram_id'&&value==='42'))
assert.ok(selected.some(([op,key])=>op==='not'&&key==='metadata_json->handoff'))

console.log('✅ dashboard run-state indicator: paused/blocked runs read as waiting, not working')
