/**
 * Test-only original-source booking-cancellation notification receipt diagnostic.
 * Expected four SAFETY RED assertions on 2026-10-31 main. DO NOT MERGE/DEPLOY.
 * Sealed VM, synthetic DB/account/provider/push data; no network or real effects.
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const file=resolve(import.meta.dirname,'../lib/agent/booking-change-worker.ts')
const source=readFileSync(file,'utf8')
const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const declaration=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='processBookingChangeWatches')
assert.ok(declaration?.body,'original booking worker must exist')
const snippet=declaration.getText(sf).replace(/^export\s+/,'')+'\nglobalThis.__testWorker=processBookingChangeWatches;'
const compiled=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true})
assert.equal(compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'source extraction must compile')

async function scenario({delta={changed:true,cancelled:true,reason:'Provider confirmed cancellation'},push={sent:1,failed:0}}={}){
  const calls={pushes:[],completed:[],deferred:[],updates:[],queries:[]}
  const watch={id:'watch-A',life_event_id:'event-A',telegram_id:'123',status:'ready',updated_at:new Date().toISOString(),payload_json:{resolvedUrl:'https://tickets.example.test/synthetic',snapshot:{title:'Concert',status:'confirmed'}}}
  const event={id:'event-A',title:'Concert',start_at:new Date(Date.now()+3600000).toISOString(),location:'Hall',lifecycle_state:'watching',metadata_json:{bookingDetails:watch.payload_json.snapshot}}
  function query(table,operation='select',payload){
    const filters=[]
    const q={
      select(...args){filters.push(['select',args]);return q},
      eq(k,v){filters.push(['eq',k,v]);return q},
      in(k,v){filters.push(['in',k,v]);return q},
      lte(k,v){filters.push(['lte',k,v]);return q},
      limit(n){filters.push(['limit',n]);return q},
      update(p){return query(table,'update',p)},
      insert(p){return query(table,'insert',p)},
      async maybeSingle(){return output()},
      then(ok,bad){return Promise.resolve(output()).then(ok,bad)}
    }
    function output(){
      calls.queries.push({table,operation,filters:[...filters]})
      const eq=k=>filters.find(x=>x[0]==='eq'&&x[1]===k)?.[2]
      if(table==='life_event_actions'&&operation==='select'){
        const stale=eq('status')==='running'
        return {data:stale?[]:[watch],error:null}
      }
      if(table==='life_event_actions'&&operation==='update'){
        assert.equal(eq('id'),watch.id)
        assert.equal(eq('status'),watch.status)
        return {data:{id:watch.id},error:null}
      }
      if(table==='life_events'&&operation==='select'){
        assert.equal(eq('id'),event.id)
        assert.equal(eq('telegram_id'),watch.telegram_id)
        return {data:event,error:null}
      }
      if(table==='life_events'&&operation==='update'){
        assert.equal(eq('id'),event.id)
        assert.equal(eq('telegram_id'),watch.telegram_id)
        calls.updates.push(payload)
        return {error:null}
      }
      if(table==='agent_activity'&&operation==='insert')return {error:null}
      throw new Error('Unexpected fake DB operation '+table+'/'+operation)
    }
    return q
  }
  const ctx=vm.createContext({
    supabaseAdmin:{from(name){return query(name)}},
    LEASE_MINUTES:10,RECHECK_HOURS:6,
    actorUserId:async id=>{assert.equal(id,watch.telegram_id);return 'user-123'},
    readProviderTicketPage:async input=>{
      assert.equal(input.userId,'user-123')
      assert.equal(input.url,watch.payload_json.resolvedUrl)
      assert.equal(input.humanHandoff,false)
      return {status:'completed',pageText:'Synthetic provider status',url:input.url}
    },
    compare:async()=>delta,
    complete:async(id,payload)=>{assert.equal(id,watch.id);calls.completed.push(payload)},
    defer:async(id,payload,hours)=>{assert.equal(id,watch.id);calls.deferred.push({payload,hours})},
    sendAgentPush:async(id,message)=>{
      assert.equal(id,watch.telegram_id)
      calls.pushes.push(message)
      if(push instanceof Error)throw push
      return push
    },
    safe:(v,max=800)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max),
    console:{error(){},warn(){},log(){}},
    Date,Promise,String,Number,Boolean,Error
  })
  vm.runInContext(compiled.outputText,ctx,{timeout:1000,filename:'booking-change-worker:original-function'})
  const result=await ctx.__testWorker(8)
  return {result,calls}
}

let controls=0,safetyPass=0,safetyFail=0,fixtureFail=0
async function check(name,kind,fn){
  try{await fn();if(kind==='control')controls++;else safetyPass++;console.log('PASS '+name)}
  catch(err){console.error('FAIL '+name+': '+(err instanceof Error?err.message:String(err)));if(kind==='control')fixtureFail++;else safetyFail++}
}
await check('normal unchanged booking defers without send','control',async()=>{
  const x=await scenario({delta:{changed:false}})
  assert.equal(x.result.changed,0)
  assert.equal(x.calls.pushes.length,0)
  assert.equal(x.calls.completed.length,0)
  assert.equal(x.calls.deferred.length,1)
})
await check('one provider-accepted push permits bounded cancellation path (not proof of recipient delivery)','control',async()=>{
  const x=await scenario({push:{sent:1,failed:0}})
  assert.equal(x.result.checked,1)
  assert.equal(x.result.changed,1)
  assert.equal(x.calls.pushes.length,1)
  assert.equal(x.calls.completed.length,1)
})
for(const [name,push] of [
  ['all push attempts failed',{sent:0,failed:1}],
  ['no registered device',{sent:0,failed:0}],
  ['push transport threw',new Error('synthetic transport outage')],
  ['one accepted and one failed device',{sent:1,failed:1}]
]){
  await check('must not assert cancellationNotified after '+name,'safety',async()=>{
    const x=await scenario({push})
    assert.equal(x.calls.completed.some(p=>p.cancellationNotified===true),false)
  })
}
console.log('BOOKING_CHANGE_PUSH_RECEIPT: controls='+controls+'/2 safety_pass='+safetyPass+'/4 safety_red='+safetyFail+' fixture_fail='+fixtureFail+' (original source, all synthetic)')
if(fixtureFail||controls!==2||safetyFail||safetyPass!==4)process.exitCode=1
