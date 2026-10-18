import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const now=Date.parse('2026-10-18T08:00:00Z')
class Clock extends Date{constructor(value?:string|number){super(value===undefined?now:value)}static now(){return now}}
const ticket='00000000-0000-4000-8000-000000000001'
const condition={contextual:true,contextualKind:'travel',contextClass:'destination_weather',expiresAt:'2026-10-20T08:05:00Z',sourceRefs:[{type:'travel_ticket',id:ticket}]}
let rejectWrite=false, rejectSource=false, mutateBeforeWrite=false, mutateStateBeforeWrite=false
let watchers:any[]=[], activity:any[]=[], sends=0, reads:any[]=[]
function reset(){watchers=[{id:'0001',telegram_id:'123',type:'web_search',active:true,next_check_at:'2026-10-18T11:00:00Z',condition_json:structuredClone(condition),last_state_json:{preserved:'yes'}}];activity=[];reads=[];rejectWrite=false;rejectSource=false;mutateBeforeWrite=false;mutateStateBeforeWrite=false}
const db={from(table:string){let filters:Array<(r:any)=>boolean>=[],patch:any,page=Infinity;const sorting:Array<{key:string,ascending:boolean,nullsFirst:boolean}>=[]
 const value=(r:any,k:string)=>k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]:r[k]
 const b:any={select(){return b},eq(k:string,v:any){filters.push(r=>['condition_json','last_state_json'].includes(k)?JSON.stringify(r[k])===v:String(value(r,k))===String(v));return b},is(k:string,v:any){filters.push(r=>value(r,k)==v);return b},in(k:string,v:any[]){filters.push(r=>v.includes(value(r,k)));return b},lte(k:string,v:string){filters.push(r=>value(r,k)!=null&&value(r,k)<=v);return b},gt(k:string,v:string){filters.push(r=>value(r,k)>v);return b},order(k:string,o:any){sorting.push({key:k,ascending:o?.ascending!==false,nullsFirst:o?.nullsFirst===true});return b},limit(n:number){page=n;return b},update(v:any){patch=v;return b},insert(v:any){activity.push(v);return b},then(resolve:any,reject:any){return Promise.resolve().then(()=>{
  if(table==='agent_activity')return {data:[],error:null}
  if(table==='travel_tickets'){if(rejectSource)return {data:null,error:{message:'unavailable'}};const rows=[{id:ticket,telegram_id:'123',depart_at:'2026-10-13T08:05:00Z',arrive_at:null},{id:ticket,telegram_id:'456',depart_at:'2026-10-19T08:05:00Z',arrive_at:null}].filter(r=>filters.every(f=>f(r)));reads.push(rows.map(r=>r.telegram_id));return {data:rows,error:null}}
  assert.equal(table,'agent_watchers')
  if(patch&&mutateBeforeWrite){watchers[0].condition_json={...watchers[0].condition_json,expiresAt:'2026-11-01T00:00:00Z'};mutateBeforeWrite=false}
  if(patch&&mutateStateBeforeWrite){watchers[0].last_state_json={preserved:'concurrent',alert:'new'};mutateStateBeforeWrite=false}
  let rows=watchers.filter(r=>filters.every(f=>f(r)));rows.sort((a,b)=>{for(const sort of sorting){const x=value(a,sort.key),y=value(b,sort.key);if(x==null&&y==null)continue;if(x==null)return sort.nullsFirst?-1:1;if(y==null)return sort.nullsFirst?1:-1;const cmp=String(x).localeCompare(String(y))*(sort.ascending?1:-1);if(cmp)return cmp}return 0});rows=rows.slice(0,page)
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
reset();watchers[0].telegram_id='456';mutateStateBeforeWrite=true;await exports.processDueAgentWatchers();assert.equal(watchers[0].last_state_json.alert,'new','retained timestamp writes preserve concurrent alert history')
reset();watchers[0].last_state_json=null;await exports.processDueAgentWatchers();assert.equal(watchers[0].active,false,'SQL-null state is guarded correctly')
reset();watchers=Array.from({length:205},(_,i)=>({...structuredClone(watchers[0]),id:String(i).padStart(4,'0')}));const paged=await exports.processDueAgentWatchers();assert.ok(reads.length<=40,'expiry sweep must not consume unbounded source reads before ordinary due work');assert.equal(paged.expired,40);for(let i=0;i<5;i++)await exports.processDueAgentWatchers();assert.ok(watchers.every(r=>!r.active),'bounded sweeps eventually retire all205 rows');assert.equal(sends,0)
reset();const seed=structuredClone(watchers[0]);watchers=[...Array.from({length:40},(_,i)=>({...structuredClone(seed),id:String(i).padStart(4,'0'),telegram_id:'456'})),...Array.from({length:45},(_,i)=>({...structuredClone(seed),id:String(i+40).padStart(4,'0')})),{...structuredClone(seed),id:'due-ordinary',type:'fixture-no-provider',condition_json:{},next_check_at:new Date(now-1000).toISOString()}];await exports.processDueAgentWatchers();assert.equal(watchers.at(-1).last_checked_at,new Date(now).toISOString(),'ordinary due work still runs after bounded sweep');await exports.processDueAgentWatchers();assert.ok(watchers.slice(40,80).every(r=>!r.active),'retained future rows rotate behind unchecked rows');assert.ok(watchers.slice(0,40).every(r=>r.active))
reset();watchers=Array.from({length:45},(_,i)=>({...structuredClone(seed),id:String(i).padStart(4,'0')}));rejectSource=true;const unavailable=await exports.processDueAgentWatchers();assert.equal(unavailable.failed,40);rejectSource=false;await exports.processDueAgentWatchers();assert.ok(watchers.slice(40).every(r=>!r.active),'failed source rows rotate so later rows receive checks')
console.log('Pre-poll expiry: owner/manual isolation, checked writes, source errors, concurrent state/condition edits, bounded rotation and205-row eventual retirement pass; no provider actions')
