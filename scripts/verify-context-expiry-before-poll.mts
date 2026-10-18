import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const now=Date.parse('2026-10-18T08:00:00Z')
class Clock extends Date{constructor(value?:string|number){super(value===undefined?now:value)}static now(){return now}}
const ticket='00000000-0000-4000-8000-000000000001'
const condition={contextual:true,contextualKind:'travel',contextClass:'destination_weather',expiresAt:'2026-10-20T08:05:00Z',sourceRefs:[{type:'travel_ticket',id:ticket}]}
let rejectWrite=false, rejectSource=false, mutateBeforeWrite=false
let watchers:any[]=[], activity:any[]=[], sends=0, reads:any[]=[]
function reset(){watchers=[{id:'0001',telegram_id:'123',type:'web_search',active:true,next_check_at:'2026-10-18T11:00:00Z',condition_json:structuredClone(condition),last_state_json:{preserved:'yes'}}];activity=[];reads=[];rejectWrite=false;rejectSource=false;mutateBeforeWrite=false}
const db={from(table:string){let filters:Array<(r:any)=>boolean>=[],patch:any,page=Infinity,sortKey='',sortAsc=true
 const value=(r:any,k:string)=>k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k]
 const b:any={select(){return b},eq(k:string,v:any){filters.push(r=>k==='condition_json'?JSON.stringify(r[k])===v:String(value(r,k))===String(v));return b},in(k:string,v:any[]){filters.push(r=>v.includes(value(r,k)));return b},lte(k:string,v:string){filters.push(r=>value(r,k)!=null&&value(r,k)<=v);return b},gt(k:string,v:string){filters.push(r=>value(r,k)>v);return b},order(k:string,o:any){sortKey=k;sortAsc=o?.ascending!==false;return b},limit(n:number){page=n;return b},update(v:any){patch=v;return b},insert(v:any){activity.push(v);return b},then(resolve:any,reject:any){return Promise.resolve().then(()=>{
  if(table==='agent_activity')return {data:[],error:null}
  if(table==='travel_tickets'){if(rejectSource)return {data:null,error:{message:'unavailable'}};const rows=[{id:ticket,telegram_id:'123',depart_at:'2026-10-13T08:05:00Z',arrive_at:null},{id:ticket,telegram_id:'456',depart_at:'2026-10-19T08:05:00Z',arrive_at:null}].filter(r=>filters.every(f=>f(r)));reads.push(rows.map(r=>r.telegram_id));return {data:rows,error:null}}
  assert.equal(table,'agent_watchers')
  if(patch&&mutateBeforeWrite){watchers[0].condition_json={...watchers[0].condition_json,expiresAt:'2026-11-01T00:00:00Z'};mutateBeforeWrite=false}
  let rows=watchers.filter(r=>filters.every(f=>f(r)));if(sortKey)rows.sort((a,b)=>String(a[sortKey]).localeCompare(String(b[sortKey]))*(sortAsc?1:-1));rows=rows.slice(0,page)
  if(patch&&rejectWrite)return {data:null,error:{message:'write unavailable'}}
  if(patch)rows.forEach(r=>Object.assign(r,structuredClone(patch)))
  return {data:structuredClone(rows),error:null}
 }).then(resolve,reject)}};return b}}
const output=ts.transpileModule(fs.readFileSync('lib/agent/watchers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports:any={};vm.runInNewContext(output,{exports,module:{exports},require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/channels/whatsapp'?{sendWhatsAppMessage:async()=>{sends++}}:{},Date:Clock,console:{error(){}},URL,Buffer})
reset();const result=await exports.processDueAgentWatchers()
assert.equal(watchers[0].active,false,'source-expired travel watch must retire before its next scheduled poll')
assert.equal(watchers[0].next_check_at,null);assert.equal(watchers[0].last_state_json.preserved,'yes');assert.equal(watchers[0].last_state_json.expiredReason,'context_window_ended')
assert.equal(result.expired,1);assert.equal(sends,0);assert.ok(reads.every(ids=>ids.every((id:string)=>id==='123')),'source reads stay owner bound')
reset();watchers.push({...structuredClone(watchers[0]),id:'manual',condition_json:{title:'Manual weather'}},{...structuredClone(watchers[0]),id:'other-owner',telegram_id:'456'})
await exports.processDueAgentWatchers();assert.equal(watchers[1].active,true);assert.equal(watchers[2].active,true,'another owner uses their own future ticket')
reset();rejectWrite=true;const failedWrite=await exports.processDueAgentWatchers();assert.equal(watchers[0].active,true);assert.equal(failedWrite.failed,1);assert.equal(activity.length,0)
reset();rejectSource=true;const failedRead=await exports.processDueAgentWatchers();assert.equal(watchers[0].active,true);assert.equal(failedRead.failed,1)
reset();mutateBeforeWrite=true;await exports.processDueAgentWatchers();assert.equal(watchers[0].active,true,'concurrent condition edits survive expiry reconciliation');assert.equal(activity.length,0)
reset();watchers=Array.from({length:205},(_,i)=>({...structuredClone(watchers[0]),id:String(i).padStart(4,'0')}));const paged=await exports.processDueAgentWatchers();assert.ok(reads.length<=40,'expiry sweep must not consume unbounded source reads before ordinary due work');assert.equal(paged.expired,40);for(let i=0;i<5;i++)await exports.processDueAgentWatchers();assert.ok(watchers.every(r=>!r.active),'bounded sweeps eventually retire all205 rows');assert.equal(sends,0)
console.log('Pre-poll expiry: actual worker retires stale sources before cadence; owner/manual isolation, checked writes, source errors, concurrent edits and205-row pagination pass; no provider actions')
