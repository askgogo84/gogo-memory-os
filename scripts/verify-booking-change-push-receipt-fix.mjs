/**
 * Original-source booking cancellation push receipt regressions.
 * Synthetic sealed DB, provider-page, push transport: no real sends or tenant data.
 * Source diagnostic adapted from frozen test-only PR #1154; original remains untouched.
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
  try {await fn();if(kind==='control')controls++;else safetyPass++;console.log('PASS '+name)}
  catch(err){console.error('FAIL '+name+': '+(err instanceof Error?err.message:String(err)));if(kind==='control')fixtureFail++;else safetyFail++}
}

await check('unchanged provider page defers without a push','control',async()=>{
  const x=await scenario({delta:{changed:false}})
  assert.equal(x.result.checked,1)
  assert.equal(x.result.changed,0)
  assert.equal(x.calls.pushes.length,0)
  assert.equal(x.calls.completed.length,0)
  assert.equal(x.calls.deferred.length,1)
  assert.equal(x.calls.updates.length,0)
})
for (const sent of [1,2]) {
  await check('unrejected Expo tickets '+sent+' permit accepted-state cancellation (NOT handset delivery)','control',async()=>{
    const x=await scenario({push:{sent,failed:0}})
    assert.equal(x.result.checked,1)
    assert.equal(x.result.changed,1)
    assert.equal(x.calls.pushes.length,1)
    assert.equal(x.calls.completed.length,1)
    assert.equal(x.calls.completed[0].cancellationNotified,true)
    assert.equal(x.calls.completed[0].cancellationPushState,'provider_accepted')
    assert.equal(x.calls.deferred.length,0)
    assert.equal(x.calls.updates.length,1)
    assert.equal(x.calls.updates[0].metadata_json.attentionRequired,true)
    assert.equal(x.calls.updates[0].lifecycle_state,'cancelled')
  })
}
await check('noncancelled booking change retains bounded scheduled recheck','control',async()=>{
  const x=await scenario({delta:{changed:true,cancelled:false,reason:'New start time'},push:{sent:0,failed:0}})
  assert.equal(x.result.changed,1)
  assert.equal(x.calls.pushes.length,1)
  assert.equal(x.calls.deferred.length,1)
  assert.equal(x.calls.completed.length,0)
  assert.equal(x.calls.updates.length,1)
  assert.equal(x.calls.updates[0].lifecycle_state,'watching')
})

const negativeCases = [
  ['no registered device', {sent:0,failed:0}, 'not_accepted'],
  ['all push attempts failed', {sent:0,failed:1}, 'not_accepted'],
  ['multiple failed push attempts', {sent:0,failed:2}, 'not_accepted'],
  ['partial provider ticket acceptance', {sent:1,failed:1}, 'partial'],
  ['transport threw after a potentially unknown send', new Error('synthetic transport uncertain'), 'outcome_unknown'],
  ['null provider result', null, 'outcome_unknown'],
  ['missing failed count', {sent:1}, 'outcome_unknown'],
  ['string count untrusted', {sent:'1',failed:0}, 'outcome_unknown'],
  ['negative accepted count', {sent:-1,failed:0}, 'outcome_unknown'],
  ['negative failed count', {sent:1,failed:-1}, 'outcome_unknown'],
  ['fractional count', {sent:1.5,failed:0}, 'outcome_unknown'],
  ['NaN count', {sent:Number.NaN,failed:0}, 'outcome_unknown'],
]
for (const [name,push,expectedState] of negativeCases) {
  await check(name+' cannot record notified; no blind replay','safety',async()=>{
    const x=await scenario({push})
    assert.equal(x.result.checked,1)
    assert.equal(x.result.changed,1)
    assert.equal(x.result.failed,0)
    assert.equal(x.calls.pushes.length,1,'one outbound attempt at most')
    assert.equal(x.calls.completed.length,1,'cancelled action terminally completes, no retry')
    assert.equal(x.calls.deferred.length,0,'unknown provider outcome cannot requeue')
    assert.equal(x.calls.updates.length,1,'owner-visible cancellation is preserved')
    assert.equal(x.calls.updates[0].lifecycle_state,'cancelled')
    assert.equal(x.calls.updates[0].metadata_json.attentionRequired,true)
    assert.equal(x.calls.completed[0].cancellationNotified,false,'no false notification receipt')
    assert.equal(x.calls.completed[0].cancellationPushState,expectedState)
  })
}
console.log('BOOKING_CHANGE_PUSH_RECEIPT: controls='+controls+'/4 safety_pass='+safetyPass+'/'+negativeCases.length+' safety_red='+safetyFail+' fixture_fail='+fixtureFail+' (original source; synthetic only)')
if(fixtureFail||controls!==4||safetyFail||safetyPass!==negativeCases.length)process.exitCode=1
