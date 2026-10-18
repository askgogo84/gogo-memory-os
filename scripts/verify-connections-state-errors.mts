import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Execute the real profile query and server page. All reads are inert; writes,
// credentials and provider calls are forbidden by this fixture.
let failures=new Set<string>(),throws=new Set<string>(),authenticated=true,emptyPermission=false,emptyCounts=false,emptyCredit=false,permissionLevel='ask'
const calls:Array<{table:string;filters:Array<[string,unknown]>}>=[]
const user={name:'Fixture',whatsapp_id:'fixture-owner',gmail_connected:true,google_calendar_connected:true,gmail_send_connected:true}
const db={from(table:string){
 const call={table,filters:[] as Array<[string,unknown]>};calls.push(call)
 const q={select(columns:string){assert.doesNotMatch(columns,/access_token|refresh_token|password|encrypted/);return q},eq(key:string,value:unknown){call.filters.push([key,value]);return q},gte(){return q},maybeSingle(){return q},then(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown){
  return Promise.resolve().then(()=>{
   if(throws.has(table))throw new Error('fixture transport failure')
   const error=failures.has(table)?{message:'fixture unavailable'}:null
   const data=error?null:table==='users'?user:table==='user_consent_settings'?{gmail_enabled:true}:table==='agent_permissions'?(emptyPermission?null:{level:permissionLevel}):table==='wa_creditiq_links'?(emptyCredit?null:{consumer_user_id:'fixture-link'}):null
   return {data,count:error?null:emptyCounts?0:table==='vault_credentials'?3:table==='travel_tickets'?2:null,error}
  }).then(resolve,reject)
 }};return q
}}
const jsx=(type:unknown,props:unknown)=>({type:typeof type==='function'?type.name:type,props})
const deps:Record<string,unknown>={
 'next/link':{default:'a'},'react/jsx-runtime':{jsx,jsxs:jsx},
 '@/lib/dashboard/session':{getSession:async()=>authenticated?{telegramId:'123'}:null},
 '@/lib/supabase-admin':{supabaseAdmin:db},
 '@/lib/services/meter':{getPlan:async()=>({plan_code:'free'})},
 '@/lib/data/limits':{getPlanLimits:()=>({free:{label:'Fixture',priceInr:0}})},
}
function load(file:string){
 const exports:Record<string,any>={}
 const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 runInNewContext(source,{exports,require:(name:string)=>deps[name]||{},Date,Number,String,Boolean,parseInt,Promise,console:{error:()=>{}},fetch:()=>{throw new Error('provider I/O forbidden')}})
 return exports
}
const profile=load('lib/dashboard/queries.ts')
deps['@/lib/dashboard/queries']={getProfile:profile.getProfile}
const page=load('app/dashboard/(app)/connections/page.tsx')
async function rows(){
 const tree=await page.default(),found=new Map<string,any>()
 function visit(node:unknown){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return}const item=node as {type?:string;props?:{name?:string};[key:string]:unknown};if(item.type==='ConnRow'&&item.props?.name)found.set(item.props.name,item.props);Object.values(item).forEach(visit)}
 visit(tree);return {tree,found}
}
failures=new Set(['agent_permissions'])
assert.match((await rows()).found.get('Secure Browser').state,/unavailable/i,'failed permission read must not claim Available or default draft')
failures=new Set(['vault_credentials','travel_tickets'])
for(const name of ['Vault','Travel context']){const row=(await rows()).found.get(name);assert.match(row.state,/unavailable/i);assert.equal(row.available,false)}
failures=new Set(['users'])
for(const name of ['Gmail','Google Calendar','Google Drive','CreditIQ'])assert.match((await rows()).found.get(name).state,/unavailable/i,name+' failed auth read is unknown, not disconnected')
assert.doesNotMatch((await rows()).found.get('Gmail').operations,/Send has not been granted/,'unknown send grant must not be presented as absent')
failures=new Set(['wa_creditiq_links'])
assert.match((await rows()).found.get('CreditIQ').state,/unavailable/i,'actual getProfile must preserve linkage-read failure')
failures=new Set(['user_consent_settings'])
assert.match((await rows()).found.get('Gmail').state,/Reading status unavailable/)
failures=new Set()
throws=new Set(['agent_permissions','vault_credentials','travel_tickets','user_consent_settings','wa_creditiq_links'])
for(const name of ['Secure Browser','Vault','Travel context','CreditIQ'])assert.match((await rows()).found.get(name).state,/unavailable/i,'transport failure must remain visible: '+name)
throws=new Set(['users'])
for(const name of ['Gmail','Google Calendar','Google Drive','CreditIQ'])assert.match((await rows()).found.get(name).state,/unavailable/i,'thrown auth read remains unknown: '+name)
throws=new Set()
emptyPermission=true
assert.match((await rows()).found.get('Secure Browser').state,/draft/i,'successful absent permission retains established draft default')
emptyPermission=false
const good=(await rows()).found
assert.equal(good.get('Gmail').state,'Connected · Send enabled')
assert.equal(good.get('Google Calendar').state,'Connected')
assert.equal(good.get('Vault').state,'3 saved logins')
assert.equal(good.get('Travel context').state,'2 upcoming legs')
assert.equal(good.get('CreditIQ').state,'Connected')
permissionLevel='off';emptyCounts=true;emptyCredit=true
const empty=(await rows()).found
assert.equal(empty.get('Secure Browser').state,'Off')
assert.equal(empty.get('Secure Browser').available,false)
assert.equal(empty.get('Vault').state,'No saved logins','known zero remains distinct from failed count')
assert.equal(empty.get('Travel context').state,'No upcoming saved travel')
assert.equal(empty.get('CreditIQ').state,'Not connected','successful absent linkage remains distinct from failure')
for(const call of calls)assert.ok(call.filters.some(([key,value])=>key==='telegram_id'&&String(value)==='123'||call.table==='wa_creditiq_links'&&key==='sender'&&value==='fixture-owner'),'every actual read stays owner-bound: '+call.table)
authenticated=false
const before=calls.length
assert.match(JSON.stringify((await rows()).tree),/sign in/i)
assert.equal(calls.length,before,'unauthenticated page performs no owner reads')
console.log('Actual Connections page/profile: failed reads remain unavailable; successful defaults, counts, auth and owner scope retained; no provider I/O')
