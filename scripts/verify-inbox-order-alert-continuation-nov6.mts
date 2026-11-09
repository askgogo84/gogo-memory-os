// Synthetic original-function regression: order alerts must still run when the
// 6 Nov per-email inbox path replaces the old digest on Vercel.
// No DB, provider calls, customer data, secrets or production side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source=readFileSync('lib/agent/watchers.ts','utf8')
const helperStart=source.indexOf('async function continueInboxOrderAlerts(')
const mailStart=source.indexOf('async function processMailAlerts(',helperStart)
const watcherStart=source.indexOf('async function processInboxTriageWatcher(',mailStart)
const stockStart=source.indexOf('async function processProductStockWatcher(',watcherStart)
assert.ok(helperStart>0&&mailStart>helperStart&&watcherStart>mailStart&&stockStart>watcherStart,'find original order+mail+legacy functions')
const mailSource=source.slice(mailStart,watcherStart)
const watcherSource=source.slice(watcherStart,stockStart)
assert.match(mailSource,/const orderTracking=await continueInboxOrderAlerts\(watcher,condition,actor,telegramId,now\)/,'new per-email mail path must check orders')
assert.match(mailSource,/mailAlerts:\{\.\.\.state,alerted:[\s\S]*?orderTracking,pendingInboxAlert:null/,'per-email checkpoint must retain order deduplication state')
assert.match(watcherSource,/return processMailAlerts\(watcher,condition,actor,telegramId,fresh,seen,messages,now\)/,'exercise live Vercel early-return path')
assert.match(watcherSource,/const orderTracking=await continueInboxOrderAlerts\(watcher,condition,actor,telegramId,now\)/,'legacy digest must share the same order helper')
assert.doesNotMatch(watcherSource,/const ot=await import\('\.\/order-tracking'\)/,'do not fork receipt logic across code paths')

const actual=source.slice(helperStart,mailStart)
const compiled=ts.transpileModule(actual+'\n;(globalThis as any).__continueOrders=continueInboxOrderAlerts;',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const due=new Date('2026-11-06T09:00:00.000Z')
type DeliveryStatus='provider_accepted'|'outcome_unknown'|'suppressed'|'failed'
function harness(status:DeliveryStatus,opts:{delivery?:string;alreadySent?:boolean;failRead?:boolean;noAlerts?:boolean}={}){
  let reads=0
  let alertsChecked=0
  const deliveries:any[]=[]
  let networkCalls=0
  const id='order-123:missed-day'
  const orders=[{id:'order-123',shop:'Test Shop',label:'synthetic'}]
  const orderMod={
    readOrders:async(actor:any)=>{reads++;assert.equal(actor.userId,'synthetic-owner');if(opts.failRead)throw Error('offline fixture');return orders},
    orderAlerts:(found:any[],sent:string[],nowMs:number)=>{
      alertsChecked++
      assert.equal(found.length,1)
      assert.equal(nowMs,due.getTime())
      return opts.noAlerts||sent.includes(id)?[]:[{id,line:'Synthetic order missed promised delivery day.'}]
    },
  }
  const scope:any={
    createHash,
    require:(name:string)=>{assert.equal(name,'./order-tracking');return orderMod},
    deliverWatchAlert:async(args:any)=>{deliveries.push(JSON.parse(JSON.stringify(args)));return {accepted:status==='provider_accepted',state:status,providerId:status==='provider_accepted'?'fake-provider-accepted':null}},
    sendWhatsApp:async()=>{networkCalls++;throw Error('NO NETWORK')},
    console:{log:()=>{},error:()=>{}},
    exports:{},module:{exports:{}},
  }
  runInNewContext(compiled,scope,{timeout:2000})
  const run=scope.__continueOrders as (watcher:any,condition:any,actor:any,owner:string,now:Date)=>Promise<any>
  assert.equal(typeof run,'function')
  const watcher={id:'synthetic-watch-9',last_state_json:{orderTracking:{alerted:opts.alreadySent?[id,'older-alert']:['older-alert']}}}
  const condition={delivery:opts.delivery||'whatsapp',cadenceMinutes:240}
  return {run:()=>run(watcher,condition,{userId:'synthetic-owner'},'42',due),deliveries,
    get reads(){return reads},get alertsChecked(){return alertsChecked},get networkCalls(){return networkCalls},id}
}

for(const status of ['provider_accepted','outcome_unknown','suppressed','failed'] as DeliveryStatus[]){
  const h=harness(status)
  const state=JSON.parse(JSON.stringify(await h.run()))
  assert.equal(h.reads,1,'always check shop order emails in default mail mode')
  assert.equal(h.alertsChecked,1)
  assert.equal(h.deliveries.length,1)
  const send=h.deliveries[0]
  assert.equal(send.owner,'42')
  assert.equal(send.watcherId,'synthetic-watch-9')
  assert.equal(send.topic,'watches')
  assert.equal(send.due,due.toISOString())
  assert.match(send.message,/Synthetic order missed promised delivery day/)
  assert.match(send.key,/^orders\/synthetic-watch-9\/[0-9a-f]{64}$/)
  assert.equal(state.alerted.includes(h.id),status==='provider_accepted'||status==='suppressed',status+' receipt semantics')
  assert.equal(state.alerted.includes('older-alert'),true,'prior dedupe state preserved')
  assert.equal(h.networkCalls,0,'no direct provider call')
  console.log('PASS original order alert '+status)
}

const duplicate=harness('provider_accepted',{alreadySent:true})
const duplicated=JSON.parse(JSON.stringify(await duplicate.run()))
assert.equal(duplicate.reads,1)
assert.equal(duplicate.deliveries.length,0,'already-alerted order does not send twice')
assert.equal(duplicated.alerted.includes(duplicate.id),true)
console.log('PASS already-alerted order remains deduplicated')

const app=harness('provider_accepted',{delivery:'app'})
await app.run()
assert.equal(app.reads,1)
assert.equal(app.deliveries.length,0,'app-only never calls provider gateway')
console.log('PASS app-only order processing uses no send')

const readFailed=harness('provider_accepted',{failRead:true})
const afterFail=JSON.parse(JSON.stringify(await readFailed.run()))
assert.deepEqual(afterFail.alerted,['older-alert'],'read failure must not invent notifications or erase prior state')
assert.equal(readFailed.deliveries.length,0)
console.log('PASS order-source failure is not claimed as notification')

console.log('inbox order-alert continuation original-function regressions passed')
