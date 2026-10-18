import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Actual projection with inert owner-checked transports. No provider, credential,
// account or stored-record mutation is allowed by this regression.
const repo=process.cwd()
const now=Date.parse('2026-10-18T12:00:00Z')
const legacy="I couldn't get provider.example to send you a sign-in code, so I stopped there. Nothing else was entered or changed."
const base={id:'run-a',telegram_id:'123',type:'secure_browser',title:'Browser · provider.example',summary:legacy,status:'paused',error:'human_auth_required',updated_at:'2026-10-18T11:00:00Z',metadata_json:{plan_type:'secure_browser',handoff:{takeoverUrl:'https://synthetic.invalid/handback',providerUrl:'https://provider.example/'}}}
let rows:any[]=[],steps:any[]=[],reasonFailure=false,writes=0
const reads:Array<{table:string;select:string;owner:boolean}>=[]
const db={from(table:string){
 assert.ok(['agent_runs','agent_steps'].includes(table),'Unexpected table '+table)
 const filters:Array<(r:any)=>boolean>=[],orders:Array<{key:string;options:any}>=[]
 let count=Infinity,fields='',owner=false
 const q:any={select:(value:string)=>{fields=value;return q},eq:(key:string,value:unknown)=>{if(key==='telegram_id'){assert.equal(value,'123');owner=true}filters.push(r=>String(r[key])===String(value));return q},
  in:(key:string,values:unknown[])=>{filters.push(r=>values.includes(r[key]));return q},gte:(key:string,value:string)=>{filters.push(r=>r[key]>=value);return q},contains:()=>q,or:()=>q,
  order:(key:string,options:any)=>{orders.push({key,options});return q},limit:(value:number)=>{count=value;return q},
  update:()=>{writes++;throw Error('unexpected write')},insert:()=>{writes++;throw Error('unexpected write')},delete:()=>{writes++;throw Error('unexpected write')},
  then:(yes:any,no:any)=>Promise.resolve().then(()=>{
   assert.equal(owner,true,table+' read must be owner bound');reads.push({table,select:fields,owner})
   if(table==='agent_steps'&&reasonFailure)return{data:null,error:{message:'synthetic unavailable'}}
   const data=structuredClone(table==='agent_runs'?rows:steps).filter((r:any)=>filters.every(f=>f(r)))
   data.sort((a:any,b:any)=>{for(const {key,options}of orders){if(a[key]===b[key])continue;if(a[key]==null||b[key]==null){const nullFirst=options?.nullsFirst===true;return a[key]==null?(nullFirst?-1:1):(nullFirst?1:-1)}return(a[key]<b[key]?-1:1)*(options?.ascending===false?-1:1)}return 0})
   return{data:data.slice(0,count).map((r:any)=>table==='agent_steps'&&fields.includes('auth_reason:')?{...r,auth_reason:r.output_json?.authReason}:r),error:null}
  }).then(yes,no)}
 return q
}}
const cache:Record<string,any>={}
function load(file:string):any{
 if(cache[file])return cache[file]
 const output:any=cache[file]={}
 runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:output,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):(()=>{throw Error('Unexpected dependency '+name)})(),Date,URL,Map,Set,console})
 return output
}
const actual=load(resolve(repo,'lib/dashboard/human-handoffs.ts'))
const step=(reason='login_unavailable',extra:Record<string,unknown>={})=>({id:'step-a',telegram_id:'123',run_id:'run-a',tool_name:'secure_browser',ordinal:1,status:'failed',error:'human_auth_required',completed_at:'2026-10-18T11:00:00Z',started_at:'2026-10-18T10:59:00Z',output_json:{authReason:reason},...extra})
const read=()=>actual.getPendingBrowserHandoffs('123',20,now)
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){rows=[structuredClone(base)];steps=[step()];reasonFailure=false;reads.length=0;try{await fn();assert.equal(writes,0);console.log('PASS '+label)}catch(e){failures.push(label+': '+String((e as Error).message).slice(0,400))}}
await check('recorded login-unavailable supersedes unsupported legacy code-send claim',async()=>{
 const cards=await read();assert.equal(cards.length,1);assert.equal(cards[0].id,'run-a');assert.match(cards[0].summary,/couldn.t sign in|could not sign in/i);assert.doesNotMatch(cards[0].summary,/send you a sign-in code/)
 assert(reads.some(r=>r.table==='agent_steps'),'Actual recorded reason must be read')
})
await check('reason projection does not rewrite stored run summary or handoff',async()=>{const original=JSON.stringify(rows);await read();assert.equal(JSON.stringify(rows),original)})
await check('foreign owner same run ID cannot change the displayed reason',async()=>{
 steps=[step('otp',{telegram_id:'456'})];const cards=await read();assert.doesNotMatch(cards[0].summary,/send you a sign-in code|couldn.t sign in/i);assert.match(cards[0].summary,/sign.in|secure|verify/i)
})
await check('other run and tool reasons cannot replace the current reason',async()=>{
 steps=[step('login_unavailable',{run_id:'other-run'}),step('login_unavailable',{tool_name:'other-tool'})];assert.doesNotMatch((await read())[0].summary,/send you a sign-in code|couldn.t sign in/i)
})
await check('a later non-auth browser step cannot reuse an earlier login failure',async()=>{
 steps=[step(),step('otp',{id:'step-later',ordinal:2,error:'other_failure',completed_at:'2026-10-18T11:01:00Z'})];assert.doesNotMatch((await read())[0].summary,/send you a sign-in code|couldn.t sign in/i)
})
await check('missing or unavailable reason is explicit uncertainty without a code-send claim',async()=>{
 for(const unavailable of [false,true]){reasonFailure=unavailable;steps=[];const card=(await read())[0];assert.match(card.summary,/couldn.t verify|cannot verify|unverified|unavailable|unknown/i);assert.doesNotMatch(card.summary,/send you a sign-in code|couldn.t sign in/i)}
})
await check('delivery-location and non-auth provider copy remain unchanged',async()=>{
 rows[0].error='delivery_location_required';rows[0].summary='Choose your delivery location in the provider browser, then resume this same task.';steps=[step('login_unavailable')];assert.equal((await read())[0].summary,rows[0].summary)
})
await check('reason lookup projects only needed fields and excludes raw browser output',async()=>{
 await read();const query=reads.find(r=>r.table==='agent_steps');assert(query);assert.match(query.select,/auth_reason:output_json->>authReason/);assert.doesNotMatch(query.select,/(?:^|,)\s*(?:\*|output_json)\s*(?:,|$)/)
})
await check('duplicate handoffs still collapse after truthful projection',async()=>{
 rows.push({...structuredClone(base),id:'run-b',updated_at:'2026-10-18T10:00:00Z'});steps.push(step('login_unavailable',{id:'step-b',run_id:'run-b'}));const cards=await read();assert.equal(cards.length,1);assert.equal(cards[0].id,'run-a');assert.equal(cards[0].repeats,1)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Actual legacy handoff reason projection: owner/run/tool provenance, uncertainty, minimal reads and no writes passed.')
