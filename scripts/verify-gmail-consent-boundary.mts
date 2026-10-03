import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise real mail readers, watch creation, conversation status and page output.
// No provider calls, real credentials or production mutations.
const actor={legacyTelegramId:101,userId:'fixture-owner',whatsappId:'fixture',name:'Fixture'}
let enabled:boolean|null=false,consentError=false,fetches=0,credentialReads=0,writes=0
const db={from(table:string){
  let single=false
  const q:any={select(columns:string){assert.ok(!columns.includes('google_calendar_connected_at'),'Connections must use columns present in the production users schema');return q},eq(key:string,value:any){if(key==='telegram_id')assert.equal(String(value),'101');return q},gte(){return q},limit(){return q},maybeSingle(){single=true;return q},insert(){writes++;throw new Error('unexpected write')},then(resolve:any,reject:any){return Promise.resolve().then(()=>{
    if(table==='user_consent_settings')return {data:enabled===null?null:{gmail_enabled:enabled},error:consentError?{message:'fixture outage'}:null}
    if(table==='users'){credentialReads++;return {data:{gmail_connected:true,gmail_send_connected:true,gmail_access_token:'fixture-only',gmail_email:'fixture@example.test'},error:null}}
    if(table==='agent_watchers')return {data:single?{id:'existing-watch',active:true}:[],error:null}
    return {data:single?null:[],count:0,error:null}
  }).then(resolve,reject)}};return q
}}
const mocks:any={
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(v:string)=>v},
  '@/lib/security/google-token-crypto':{decryptGoogleToken:(v:string)=>v,hasGoogleTokenEncryptionKey:()=>false},
  '@/lib/dashboard/session':{getSession:async()=>({telegramId:'101'})},
  '@/lib/dashboard/queries':{getProfile:async()=>({ok:true,connections:{gmail:true,googleCalendar:true,creditiq:false}})},
  'react/jsx-runtime':{jsx:(type:any,props:any)=>({type:typeof type==='function'?type.name:type,props}),jsxs:(type:any,props:any)=>({type:typeof type==='function'?type.name:type,props})},
}
function load(file:string){
  const exports:any={}
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(source,{exports,module:{exports},require:(name:string)=>mocks[name]||{},URL,URLSearchParams,console,fetch:async()=>{fetches++;return {ok:true,status:200,json:async()=>({messages:[],files:[]})}}})
  return exports
}
const reads=load('lib/agent/google-workspace-read.ts')
for(const action of [()=>reads.listRecentWorkspaceInbox(actor),()=>reads.searchWorkspaceEmails(actor,'meeting')]){
  await assert.rejects(action,/workspace_email_reading_disabled/)
}
assert.equal(fetches,0)
assert.equal(credentialReads,0,'disabled mail reading must stop before loading tokens')
await reads.searchWorkspaceDrive(actor,'agenda')
assert.equal(fetches,1,'email preference must not disconnect independent Drive access')
fetches=0;credentialReads=0
consentError=true
await assert.rejects(()=>reads.listRecentWorkspaceInbox(actor),/workspace_email_consent_unavailable/)
assert.equal(fetches,0)
consentError=false
for(const value of [true,null]){
  enabled=value
  await reads.listRecentWorkspaceInbox(actor)
}
assert.equal(fetches,2,'enabled and legacy absent preference retain allowed access')

enabled=false
const watches=load('lib/agent/watch-command.ts')
const refused=await watches.tryCreateInboxTriageWatchFromCommand({actor,surface:'web',text:'Monitor my inbox for important emails'})
assert.equal(refused.status,'paused')
assert.equal(refused.blockedReason,'workspace_email_reading_disabled')
assert.equal(writes,0)
const status=load('lib/agent/autonomy-status.ts')
assert.match((await status.tryGetConnectionStatus({actor,text:'Show my connected accounts'})).text,/Gmail reading: off/i)
const page=load('app/dashboard/(app)/connections/page.tsx')
assert.match(JSON.stringify(await page.default()),/Connected · Reading off/)
consentError=true
assert.match(JSON.stringify(await page.default()),/Reading status unavailable/)
consentError=false;enabled=true
assert.match(JSON.stringify(await page.default()),/Connected · Send enabled/)
assert.match((await watches.tryCreateInboxTriageWatchFromCommand({actor,surface:'whatsapp',text:'Monitor my inbox for important emails'})).text,/already active/)
assert.equal(writes,0)
console.log('PASS: Gmail privacy preference enforced before tokens/network; watch, chat and dashboard agree; Drive retained; failed consent reads fail closed')
