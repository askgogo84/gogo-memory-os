// Original-source, sealed provider/DB fixture. No real accounts or external calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, name, deps) {
  const ast = ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
  const fn = ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)
  assert.ok(fn, 'original implementation missing '+name)
  const code=ts.transpileModule(fn.getText(ast)+'\nmodule.exports={'+name+'};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}}
  vm.runInNewContext(code,{module,exports:module.exports,console,URL,URLSearchParams,...deps},{timeout:2000,filename:path})
  return module.exports[name]
}
let consent=true, error=false, tokens=0, requests=0, lookedUp=''
const db={from(table){
  assert.equal(table,'user_consent_settings')
  return {select(columns){assert.ok(columns.includes('gmail_enabled'));return this},
    eq(key,v){assert.equal(key,'telegram_id');lookedUp=String(v);return this},
    async maybeSingle(){return {data:consent==='missing'?null:{gmail_enabled:consent},error:error?{message:'fixture unavailable'}:null}}}
}}
const workspace=load('lib/agent/google-workspace-read.ts','workspaceFetch',{
  supabaseAdmin:db,
  credentials:async()=>{tokens++;return {gmail_access_token:'fictional-token',gmail_refresh_token:null}},
  refresh:async()=>{throw Error('unexpected refresh')},
  composioDriveFor:async()=>null,
  fetch:async()=>{requests++;return {status:200,ok:true}}
})
const actor={legacyTelegramId:101,userId:'fictional-a'}
const gmail='https://gmail.googleapis.com/gmail/v1/users/me/messages'
await workspace(actor,gmail)
assert.deepEqual([tokens,requests,lookedUp],[1,1,'101'])
console.log('BENIGN: affirmative consent reads Gmail')
for(const value of [false,null,undefined,'missing']){
  consent=value;error=false
  const prior=[tokens,requests]
  await assert.rejects(()=>workspace(actor,gmail),/workspace_email_reading_disabled/)
  assert.deepEqual([tokens,requests],prior,'no credential read or provider request')
  console.log('MANDATORY: denied '+String(value))
}
error=true
const priorError=[tokens,requests]
await assert.rejects(()=>workspace(actor,gmail),/workspace_email_consent_unavailable/)
assert.deepEqual([tokens,requests],priorError)
console.log('MANDATORY: failed preference lookup denied')
error=false;consent=true
await workspace({legacyTelegramId:-2251799813685248},gmail)
assert.equal(lookedUp,'-2251799813685248')
console.log('BENIGN: valid negative WhatsApp owner')
const beforeUnsafe=[tokens,requests]
await assert.rejects(()=>workspace({legacyTelegramId:9007199254740992},gmail),/workspace_owner_invalid/)
assert.deepEqual([tokens,requests],beforeUnsafe)
console.log('MANDATORY: unsafe numeric owner denied')
consent=null
const beforeDrive=[tokens,requests]
await workspace(actor,'https://www.googleapis.com/drive/v3/files')
assert.deepEqual([tokens,requests],[beforeDrive[0]+1,beforeDrive[1]+1])
console.log('BENIGN: independent Drive still works')

let watcherUserReads=0,watcherExistingReads=0,watcherWrites=0,watchConsent=null,watchError=false
const watcherDb={from(table){return {
  select(){return this},eq(k,v){if(k==='telegram_id')assert.equal(String(v),'101');return this},limit(){return this},
  insert(){watcherWrites++;throw Error('fixture forbids mutation')},
  async maybeSingle(){
    if(table==='user_consent_settings')return {data:watchConsent==='missing'?null:{gmail_enabled:watchConsent},error:watchError?{message:'fixture outage'}:null}
    if(table==='users'){watcherUserReads++;return {data:{gmail_connected:true},error:null}}
    if(table==='agent_watchers'){watcherExistingReads++;return {data:{id:'fictional-existing',active:true},error:null}}
    throw Error('unexpected '+table)
  }
}}}
const watch=load('lib/agent/watch-command.ts','tryCreateInboxTriageWatchFromCommand',{
  supabaseAdmin:watcherDb,
  parseInboxTriageWatchCommand:()=>({title:'Fixture',delivery:'whatsapp',cadenceMinutes:60}),
  buildGmailConnectUrl:()=> 'https://example.test/connect',clean:x=>String(x)
})
const args={actor,surface:'web',text:'Monitor my inbox for important emails'}
for(const value of [false,null,undefined,'missing']){
  watchConsent=value;watchError=false
  const result=await watch(args)
  assert.equal(result.status,'paused')
  assert.equal(result.blockedReason,'workspace_email_reading_disabled')
  assert.deepEqual([watcherUserReads,watcherExistingReads,watcherWrites],[0,0,0])
  console.log('MANDATORY: no watcher for '+String(value))
}
watchError=true
await assert.rejects(()=>watch(args),/inbox_watch_consent_read_failed/)
assert.deepEqual([watcherUserReads,watcherExistingReads,watcherWrites],[0,0,0])
console.log('MANDATORY: watcher preference error denied')
watchError=false;watchConsent=true
const good=await watch(args)
assert.equal(good.status,'completed')
assert.match(good.text,/already active/)
assert.deepEqual([watcherUserReads,watcherExistingReads,watcherWrites],[1,1,0])
console.log('BENIGN: authorized pre-existing watch reused')
console.log('PASS: 4 benign controls + 11 mandatory original-source synthetic privacy assertions')
