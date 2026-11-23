// Synthetic actual-function regression for owner-bound mail-alert context reads.
// Uses injected DB and module fixtures; no Gmail/WhatsApp/provider traffic or production writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const rulesSource=readFileSync('lib/email/attention-store.ts','utf8')
const rulesStart=rulesSource.indexOf('function exactRuleOwner(')
const rulesEnd=rulesSource.indexOf('export async function saveRule(',rulesStart)
assert.ok(rulesStart>0&&rulesEnd>rulesStart,'find real rule owner parser and loadRules implementation')
const transpile=(s:string)=>ts.transpileModule(s,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText

const ruleReads:Array<Array<[string,unknown]>>=[]
const rulesDb={
  from(table:string){
    assert.equal(table,'email_attention_rules')
    const filters:Array<[string,unknown]>=[]
    const q:any={
      select(){return q},
      eq(column:string,value:unknown){filters.push([column,value]);return q},
      limit(){
        ruleReads.push([...filters])
        return Promise.resolve({data:[{id:'r1',kind:'always',match_type:'sender',match_value:'owner@example.test',category:null,label:'Owner',source:'fixture'}],error:null})
      },
    }
    return q
  },
}
const ruleExports:any={}
vm.runInNewContext(transpile(rulesSource.slice(rulesStart,rulesEnd)),{
  exports:ruleExports,module:{exports:ruleExports},supabaseAdmin:rulesDb,
  Number,BigInt,String,console,
},{filename:'actual-attention-rules.fixture.js'})
const loadRules=ruleExports.loadRules as (owner:string|number)=>Promise<any[]>
assert.equal(typeof loadRules,'function')

for(const owner of ['9223372036854775806','9223372036854775807','-9223372036854775808','-9223372036854775807']){
  ruleReads.length=0
  assert.equal((await loadRules(owner)).length,1)
  assert.deepEqual(ruleReads,[ [['telegram_id',owner],['active',true]] ],
    'exact signed BIGINT owner string is the only rules key')
}
for(const owner of ['42','-42',42,-42]){
  ruleReads.length=0
  await loadRules(owner)
  assert.deepEqual(ruleReads,[ [['telegram_id',Number(owner)],['active',true]] ],
    'legacy safe owners remain compatible')
}
for(const owner of ['9223372036854775808','-9223372036854775809','42tail','0042','+42',' 42','42 ','4.2','4e2','-0','',0,Number.MAX_SAFE_INTEGER+1,NaN,Infinity]){
  ruleReads.length=0
  await assert.rejects(loadRules(owner as string|number),/email_attention_owner_invalid/)
  assert.equal(ruleReads.length,0,'invalid owner made no rules DB read: '+String(owner))
}

const watcherSource=readFileSync('lib/agent/watchers.ts','utf8')
const watcherStart=watcherSource.indexOf('async function processMailAlerts(')
const watcherEnd=watcherSource.indexOf('  const emails=fresh.map(',watcherStart)
assert.ok(watcherStart>0&&watcherEnd>watcherStart,'extract actual processMailAlerts context read prefix')
const sourcePrefix=watcherSource.slice(watcherStart,watcherEnd)
const ownerHelperStart=watcherSource.indexOf('function exactWatcherOwner(')
const ownerHelperEnd=watcherSource.indexOf('\nexport async function sourceBoundTravelExpiry',ownerHelperStart)
assert.ok(ownerHelperStart>0&&ownerHelperEnd>ownerHelperStart,'find actual watcher owner validator')
const ownerHelper=watcherSource.slice(ownerHelperStart,ownerHelperEnd)
const scopeExports:any={}
const sandbox:any={}
const attentionOwners:unknown[]=[]
const tripKeys:unknown[]=[]
let externalCalls=0
const db={
  from(table:string){
    assert.equal(table,'travel_tickets','mail context cannot query unowned tables')
    const q:any={
      select(){return q},
      eq(column:string,value:unknown){assert.equal(column,'telegram_id');tripKeys.push(value);return q},
      gte(){return q},lte(){return q},order(){return q},limit(){return q},
      then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){
        return Promise.resolve({data:[{from_city:'BLR',to_city:'AUH',depart_at:'2026-12-01T02:00:00.000Z',arrive_at:'2026-12-01T06:00:00.000Z'}],error:null}).then(resolve,reject)
      },
    }
    return q
  },
}
const fixtureModules:Record<string,unknown>={
  '@/lib/email/mail-alerts':{normalizeRules:()=>({})},
  '@/lib/email/attention-store':{loadRules:async(owner:unknown)=>{attentionOwners.push(owner);return []}},
  './calendar-read':{executeReadOnlyCalendarStep:async()=>({output:{events:[]}})},
}
Object.assign(sandbox,{
  exports:scopeExports,module:{exports:scopeExports},Number,BigInt,String,Date,Promise,
  supabaseAdmin:db,
  require(name:string){if(name in fixtureModules)return fixtureModules[name];externalCalls++;throw Error('unexpected external module: '+name)},
  setTimeout:()=>0,
  console:{error:()=>{},log:()=>{}},
})
vm.runInNewContext(transpile(ownerHelper+'\n'+sourcePrefix+'\n return {attention,trips}\n}\n;(globalThis as any).__contextRead=processMailAlerts;'),sandbox,{filename:'actual-mail-alert-context.fixture.js'})
const contextRead=sandbox.__contextRead as any
assert.equal(typeof contextRead,'function','actual context function must be exposed')

const now=new Date('2026-11-23T00:00:00.000Z')
for(const owner of ['9223372036854775806','9223372036854775807','-9223372036854775808','-42','42']){
  attentionOwners.length=0;tripKeys.length=0
  const result=await contextRead({condition_json:{mailAlerts:{}},last_state_json:{}},{},{name:'Fixture',timezone:'Asia/Kolkata'},owner,[],[],[],now)
  assert.equal(result.trips.length,1)
  assert.deepEqual(attentionOwners,[owner],'attention rules get exact text only')
  assert.deepEqual(tripKeys,[owner],'travel tickets get exact owner text only')
}
for(const owner of ['9223372036854775808','-9223372036854775809','42tail','0']){
  attentionOwners.length=0;tripKeys.length=0
  await assert.rejects(contextRead({condition_json:{}},{},{},owner,[],[],[],now),/mail_alert_context_owner_invalid/)
  assert.equal(attentionOwners.length+tripKeys.length,0,'no private reads for invalid owner')
}
assert.equal(externalCalls,0,'no network or provider module was loaded')
console.log('verify-mail-alert-context-owner-nov23: exact signed owner in real rules/travel context reads; zero network traffic')
