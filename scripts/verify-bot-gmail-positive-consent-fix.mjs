// Sealed original-function source/DB test: fictional owners only; no providers or real tokens.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadFunction(path, name, deps) {
  const ast=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)
  assert.ok(fn,'original implementation must still exist: '+name)
  const js=ts.transpileModule(fn.getText(ast)+'\nmodule.exports={'+name+'};',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText
  const module={exports:{}}
  vm.runInNewContext(js,{module,exports:module.exports,console,...deps},{timeout:2000,filename:path})
  return module.exports[name]
}

const state={
  consent:true,consentError:false,userError:false,userMissing:false,connected:true,
  refreshToken:'',accessToken:'fictional-access',
  consentReads:0,userReads:0,decrypts:0,refreshes:0,owners:[],sequence:[],
}
const db={from(table){
  assert.ok(['users','user_consent_settings'].includes(table))
  let owner=null
  return {
    select(fields){
      if(table==='user_consent_settings')assert.equal(fields,'gmail_enabled')
      if(table==='users')assert.match(fields,/gmail_refresh_token/)
      return this
    },
    eq(key,value){assert.equal(key,'telegram_id');owner=String(value);state.owners.push([table,owner]);return this},
    async maybeSingle(){
      assert.notEqual(owner,null,'query must bind the exact requested owner')
      state.sequence.push(table)
      if(table==='user_consent_settings'){
        state.consentReads++
        return {data:state.consent==='missing'?null:{gmail_enabled:state.consent},
          error:state.consentError?{message:'fictional-consent-db-outage'}:null}
      }
      state.userReads++
      return {data:state.userMissing?null:{
        gmail_connected:state.connected,gmail_email:'synthetic.owner@example.invalid',
        gmail_access_token:state.accessToken,gmail_refresh_token:state.refreshToken,
      },error:state.userError?{message:'fictional-user-db-outage'}:null}
    },
  }
}}
const read=loadFunction('lib/bot/handlers/gmail-read.ts','gmailAccess',{
  supabaseAdmin:db,
  decryptGoogleToken(value){state.decrypts++;return String(value||'')},
  async refreshGmailAccessToken(value){state.refreshes++;assert.equal(value,'fictional-refresh');return 'fictional-refreshed-access'},
})
const snapshot=()=>({consentReads:state.consentReads,userReads:state.userReads,
  decrypts:state.decrypts,refreshes:state.refreshes})
let controls=0,mandatory=0
async function check(kind,name,fn){
  await fn()
  if(kind==='BENIGN')controls++;else mandatory++
  console.log(kind+': '+name)
}

await check('BENIGN','affirmative saved opt-in permits explicitly connected Gmail',async()=>{
  const before=snapshot()
  const result=await read(101)
  assert.equal(result.connected,true)
  assert.equal(result.disabled,false)
  assert.equal(result.accessToken,'fictional-access')
  assert.equal(result.email,'synthetic.owner@example.invalid')
  assert.equal(state.consentReads-before.consentReads,1)
  assert.equal(state.userReads-before.userReads,1)
  assert.equal(state.decrypts-before.decrypts,2) // refresh token + access token
  assert.equal(state.refreshes-before.refreshes,0)
  assert.deepEqual(state.sequence.slice(-2),['user_consent_settings','users'],
    'saved consent must be read before encrypted credentials')
})
await check('BENIGN','valid negative WhatsApp owner retains its exact signed value',async()=>{
  const before=state.owners.length
  const result=await read(-2251799813685248)
  assert.equal(result.connected,true)
  assert.deepEqual(state.owners.slice(before),[
    ['user_consent_settings','-2251799813685248'],['users','-2251799813685248'],
  ])
})
await check('BENIGN','affirmatively consented but disconnected Gmail remains disconnected',async()=>{
  state.connected=false
  const before=snapshot(),result=await read(101)
  assert.equal(result.connected,false)
  assert.equal(result.disabled,false)
  assert.equal(state.decrypts,before.decrypts)
  state.connected=true
})
await check('BENIGN','affirmatively consented refresh-token flow is unchanged',async()=>{
  state.refreshToken='fictional-refresh'
  const before=snapshot(),result=await read(101)
  assert.equal(result.accessToken,'fictional-refreshed-access')
  assert.equal(state.refreshes-before.refreshes,1)
  state.refreshToken=''
})

for(const value of [false,null,undefined,'missing']){
  await check('MANDATORY','reject Gmail read with preference '+String(value),async()=>{
    state.consent=value;state.consentError=false
    const before=snapshot(),result=await read(101)
    assert.equal(result.disabled,true)
    assert.equal(result.connected,false)
    assert.equal(result.accessToken,'')
    assert.equal(state.consentReads-before.consentReads,1)
    assert.equal(state.userReads,before.userReads,'must not fetch encrypted token columns before consent')
    assert.equal(state.decrypts,before.decrypts)
    assert.equal(state.refreshes,before.refreshes)
  })
}
await check('MANDATORY','failed consent lookup never falls through to Gmail tokens',async()=>{
  state.consent=true;state.consentError=true
  const before=snapshot()
  await assert.rejects(()=>read(101),/gmail_consent_read_failed/)
  assert.equal(state.userReads,before.userReads)
  assert.equal(state.decrypts,before.decrypts)
  assert.equal(state.refreshes,before.refreshes)
  state.consentError=false
})

for(const owner of [0,9007199254740992,-9007199254740992,101.5,NaN,Infinity]){
  await check('MANDATORY','unsafe or malformed owner rejected pre-DB: '+String(owner),async()=>{
    const before=snapshot(),result=await read(owner)
    assert.equal(result.connected,false)
    assert.equal(result.disabled,true)
    assert.equal(result.accessToken,'')
    assert.deepEqual(snapshot(),before,'unsafe owner must not query DB or handle tokens')
  })
}
await check('MANDATORY','user-row lookup error never decrypts or refreshes tokens',async()=>{
  state.consent=true;state.userError=true
  const before=snapshot()
  await assert.rejects(()=>read(101),/gmail_user_read_failed/)
  assert.equal(state.decrypts,before.decrypts)
  assert.equal(state.refreshes,before.refreshes)
  state.userError=false
})

// All direct bot Gmail consumers must continue to pass through the shared checked gate.
// The multi-source attention-card early return is explicitly out of scope (#1222).
const source=fs.readFileSync('lib/bot/handlers/gmail-read.ts','utf8')
for(const fn of ['buildGmailReadReply','buildDraftRepliesReply','latestEmailFrom','awaitingRepliesReply','jobApplicationsReply']){
  const body=source.split('export async function '+fn)[1]
  assert.ok(body&&body.split(/\nexport /)[0].includes('await gmailAccess(telegramId)'),
    'direct Gmail consumer lost the shared consent gate: '+fn)
}
console.log('PASS: '+controls+' benign controls, '+mandatory+' mandatory synthetic original-source owner/consent assertions; no real mail, DB or provider access')
