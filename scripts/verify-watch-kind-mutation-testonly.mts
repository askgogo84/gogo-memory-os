/**
 * TEST ONLY: source-executing owner-scoped watcher-kind mutation safety.
 * Inert VM and in-memory database. Never connects to providers or accounts.
 * Intentional RED for current implementation until Claude's correction.
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const src=readFileSync('lib/agent/watch-command.ts','utf8')
const compiled=ts.transpileModule(src,{fileName:'watch-command.ts',compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
}}).outputText
const owner='synthetic-owner-a',foreign='synthetic-owner-b'
type Row=Record<string,any>
const watch=(id:string,type:string,active:boolean,more:Record<string,any>={})=>({
  id,telegram_id:owner,type,active,created_at:'2026-10-30T05:00:00Z',
  updated_at:'2026-10-30T06:00:00Z',condition_json:{
    title:'Sony WH-1000XM5',query:'Sony WH-1000XM5',
  },cadence_minutes:60,last_state_json:{},...more,
})
const price=(id='price-1',active=true)=>watch(id,'web_search',active,{
  condition_json:{title:'Sony WH-1000XM5',query:'Sony WH-1000XM5 Amazon below 22000',priceRule:{threshold:22000}},
})
const stock=(active=true)=>watch('stock-1','product_stock',active,{
  condition_json:{title:'Sony WH-1000XM5',query:'Sony WH-1000XM5 available',variant:'Black'},
})
const search=(active=true)=>watch('search-1','web_search',active,{
  condition_json:{title:'Sony WH-1000XM5',query:'Sony WH-1000XM5 reviews specifications'},
})
function fixture(input:Row[]) {
  const rows=input.map(x=>structuredClone(x))
  const activity:Row[]=[]
  const writes:Row[]=[]
  const reads:Array<{table:string;key:string;value:unknown}>=[]
  const db={from(table:string){
    if(!['agent_watchers','agent_ideas','agent_activity'].includes(table))
      throw new Error('Unexpected DB table '+table)
    let filters:Array<(r:Row)=>boolean>=[]
    let changes:Row|null=null,insert:Row|null=null,one=false,ordered=false,lim=1000
    const q:any={
      select(_columns?:string){return q},
      eq(key:string,value:any) {
        reads.push({table,key,value})
        filters.push(r=>String(r[key])===String(value))
        return q
      },
      neq(key:string,value:any){filters.push(r=>String(r[key])!==String(value));return q},
      in(key:string,values:any[]){filters.push(r=>values.includes(r[key]));return q},
      contains(_key:string,_value:any){return q},
      order(key:string,options?:any){if(key==='updated_at')ordered=true;return q},
      limit(value:number){lim=value;return q},
      range(_from:number,_to:number){return q},
      update(value:Row){changes=value;return q},
      insert(value:Row){insert=value;return q},
      maybeSingle(){one=true;return q},
      single(){one=true;return q},
      then(resolve:any,reject:any){
        return Promise.resolve().then(()=>{
          const source=table==='agent_watchers'?rows:table==='agent_activity'?activity:[]
          let selected=source.filter(r=>filters.every(f=>f(r)))
          if(ordered)selected=selected.slice().sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')))
          selected=selected.slice(0,lim)
          if(changes)for(const r of selected){Object.assign(r,structuredClone(changes));writes.push({table,id:r.id,change:structuredClone(changes)})}
          if(insert){activity.push(structuredClone(insert));return {data:one?insert:[insert],error:null}}
          return {data:one?(selected[0]||null):structuredClone(selected),error:null}
        }).then(resolve,reject)
      },
    }
    return q
  }}
  const ex:Record<string,any>={},mod={exports:ex}
  const allowed=new Set([
    '@/lib/services/cost-guard','@/lib/services/google-gmail',
    '@/lib/bot/handlers/followup-state','./watchers','./watch-dedupe','./watch-cost-policy',
  ])
  const requireMock=(id:string)=>{
    if(id==='@/lib/supabase-admin')return {supabaseAdmin:db}
    if(id==='./price-threshold')return {
      parseMoneyAmount:(raw:string)=>Number(String(raw).replace(/[^0-9.]/g,'')),
      formatRupees:(amount:number)=>'₹'+amount.toLocaleString('en-IN'),
    }
    if(id==='./typed-object-context')return {
      latestTypedContext:async()=>null,selectedTypedObject:async()=>null,
      rememberTypedObjects:async()=>undefined,
    }
    if(allowed.has(id))return {}
    throw new Error('Unexpected import '+id)
  }
  runInNewContext(compiled,{
    exports:ex,module:mod,require:requireMock,
    Date,URL,URLSearchParams,Buffer,console,process:{env:{}},
    setTimeout,clearTimeout,
  },{filename:'inert-watch-command.cjs',timeout:3000})
  const actor={legacyTelegramId:owner}
  return {rows,writes,reads,activity,
    stop:(text:string)=>ex.tryStopWatcherFromCommand({actor,text}),
    restart:(text:string)=>ex.tryRestartWatcherFromCommand({actor,text}),
  }
}
let positive=0,safety=0,fail=0
async function check(label:string,kind:'positive'|'safety',test:()=>Promise<void>){
  try {await test();if(kind==='positive')positive++;else safety++;console.log('PASS ['+kind+'] '+label)}
  catch(e){fail++;console.error('FAIL ['+kind+'] '+label+': '+(e instanceof Error?e.message.split('\n')[0]:String(e)))}
}
const requestStop='stop the Sony WH-1000XM5 search watch'
const requestRestart='restart the Sony WH-1000XM5 search watch'
await check('no matching name fails closed without mutation','positive',async()=>{
  const f=fixture([price()]);const result=await f.stop('stop the Canon EOS R10 search watch')
  assert.equal(result.status,'paused');assert.equal(f.writes.length,0)
})
await check('one exact web_search watch is stopped with owner-bound read-after-write','positive',async()=>{
  const f=fixture([search(),price('other-price',true)])
  // Different product name prevents a tie.
  f.rows[1].condition_json={title:'Canon EOS R10',query:'Canon EOS R10 below 30000',priceRule:{threshold:30000}}
  const result=await f.stop(requestStop)
  assert.equal(result.status,'completed',result.text)
  assert.equal(f.rows[0].active,false)
  assert.equal(f.rows[1].active,true)
  assert.ok(f.reads.some(x=>x.table==='agent_watchers'&&x.key==='telegram_id'&&x.value===owner))
  assert.ok(f.writes.every(w=>w.table==='agent_watchers'&&w.id==='search-1'))
})
await check('one stopped search restarts with exact owner and canonical verification','positive',async()=>{
  const f=fixture([search(false),watch('foreign','web_search',false,{
    telegram_id:foreign,condition_json:{title:'Sony WH-1000XM5',query:'Sony WH-1000XM5'}})])
  const result=await f.restart(requestRestart)
  assert.equal(result.status,'completed',result.text)
  assert.equal(f.rows[0].active,true)
  assert.equal(f.rows[1].active,false)
  assert.ok(f.writes.every(w=>w.id==='search-1'))
  assert.ok(f.reads.filter(x=>x.key==='telegram_id').every(x=>x.value===owner))
})
await check('explicit price alert prefers price over search','positive',async()=>{
  const f=fixture([price('price-1',false),search(false)])
  const result=await f.restart('restart the Sony WH-1000XM5 price alert watch')
  assert.equal(result.status,'completed',result.text)
  assert.equal(f.rows[0].active,true);assert.equal(f.rows[1].active,false)
})
await check('stop search must not stop product_stock when price and stock tie and no web_search exists','safety',async()=>{
  const f=fixture([price(),stock()])
  const result=await f.stop(requestStop)
  assert.equal(result.status,'paused','absent requested kind must request clarification')
  assert.equal(f.writes.length,0,'no watch may be stopped')
  assert.equal(f.rows[0].active,true);assert.equal(f.rows[1].active,true)
})
await check('restart search must not restart product_stock when price and stock tie','safety',async()=>{
  const f=fixture([price('price-1',false),stock(false)])
  const result=await f.restart(requestRestart)
  assert.equal(result.status,'paused','absent search must not restart a stock watcher')
  assert.equal(f.writes.length,0)
})
await check('restart search must not fall back to newest of only price alerts','safety',async()=>{
  const f=fixture([price('price-new',false),price('price-old',false)])
  f.rows[1].updated_at='2026-10-29T05:00:00Z'
  const result=await f.restart(requestRestart)
  assert.equal(result.status,'paused','explicit requested kind absent')
  assert.equal(f.writes.length,0)
})
await check('restart price alert must not fall back to only generic search watches','safety',async()=>{
  const f=fixture([search(false),watch('search-2','web_search',false)])
  const result=await f.restart('restart the Sony WH-1000XM5 price alert watch')
  assert.equal(result.status,'paused','explicit requested price-kind absent')
  assert.equal(f.writes.length,0)
})
await check('when stock, search and price tie, stop search changes only actual web_search','safety',async()=>{
  const f=fixture([price(),stock(),search()])
  const result=await f.stop(requestStop)
  assert.equal(result.status,'completed',result.text)
  assert.equal(f.rows.find(x=>x.id==='search-1')?.active,false)
  assert.equal(f.rows.find(x=>x.id==='stock-1')?.active,true)
  assert.equal(f.rows.find(x=>x.id==='price-1')?.active,true)
  assert.deepEqual(f.writes.map(x=>x.id),['search-1'])
})
console.log('SUMMARY positives='+positive+'/4 safety='+safety+'/5 failures='+fail)
if(fail>0)process.exitCode=1
