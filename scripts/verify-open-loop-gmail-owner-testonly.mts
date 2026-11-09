// Independent owner-isolation regression. EXPECTED SAFETY RED on 2026-10-30.
// Executes the shipped open-loops.ts private functions in an isolated VM.
// Synthetic accounts only; every external import is explicitly stubbed.
// No production clients, network, credentials, users, Gmail, or database calls.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const OWNER_A='9007199254740992'
const OWNER_B='9007199254740993'
const SAFE='123456789'
assert.equal(Number(OWNER_A),Number(OWNER_B),'test pair must alias as unsafe JS numbers')

type User={gmail_connected:boolean;gmail_email:string;gmail_access_token:string|null;gmail_refresh_token:string|null;whatsapp_id:string}
const user=(who:string):User=>({
  gmail_connected:true,
  gmail_email:who+'@example.invalid',
  gmail_access_token:'FAKE_ACCESS_'+who,
  gmail_refresh_token:null,
  whatsapp_id:'whatsapp:+1555000000'+(who==='A'?'1':who==='B'?'2':'3'),
})
type Consent={gmail_enabled:boolean}
type Lookup={table:string;column:string;value:unknown}

function makeDb(users:Map<string,User>,consent:Map<string,Consent>){
  const lookups:Lookup[]=[]
  const admin={
    from(table:string){
      if(table!=='users'&&table!=='user_consent_settings'){
        throw Error('BLOCKED external table '+table)
      }
      let queried:unknown
      return {
        select(_columns:string){return this},
        eq(column:string,value:unknown){
          assert.equal(column,'telegram_id')
          queried=value
          lookups.push({table,column,value})
          return this
        },
        async maybeSingle(){
          const rows=table==='users'?users:consent
          return {data:(rows as Map<string,User|Consent>).get(String(queried))??null,error:null}
        },
      }
    },
  }
  return {admin,lookups}
}

function harness(users:Map<string,User>,consent:Map<string,Consent>){
  const {admin,lookups}=makeDb(users,consent)
  const mailboxReads:string[]=[]
  const tokenDecrypts:string[]=[]
  const source=readFileSync('lib/agent/open-loops.ts','utf8')
    +'\nexport { readGmailAttention, userConnection };\n'
  const compiled=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
    fileName:'lib/agent/open-loops.ts',reportDiagnostics:true,
  })
  const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
  assert.equal(errors.length,0,'original shipped source must transpile')
  const mod={exports:{} as Record<string,any>}
  const deps:Record<string,any>={
    'node:crypto':{createHash},
    '@/lib/supabase-admin':{supabaseAdmin:admin},
    '@/lib/security/google-token-crypto':{
      decryptGoogleToken(value:unknown){
        if(value)tokenDecrypts.push(String(value))
        return typeof value==='string'?value:''
      },
    },
    '@/lib/services/google-gmail':{
      async fetchGmailAttentionThreads(accessToken:string,limit:number){
        assert.equal(limit,12)
        mailboxReads.push(accessToken)
        return []
      },
      async refreshGmailAccessToken(){throw Error('BLOCKED token refresh')},
    },
    './google-workspace-read':{formatEmailSnippet:(x:unknown)=>String(x)},
    '@/lib/email/attention':{scoreEmail:()=>({score:0,picked:false})},
    './task-lifecycle':{
      retiredRunReason:()=>null,
      isTaskInventoryQuestion:()=>false,
      isRelevantOpenLoop:()=>true,
      openLoopStatus:()=>('active'),
    },
  }
  const sandbox={
    module:mod,exports:mod.exports,Date,Buffer,URL,console,
    process:{env:{}},
    require(name:string){
      if(!Object.prototype.hasOwnProperty.call(deps,name))throw Error('BLOCKED import '+name)
      return deps[name]
    },
  }
  runInNewContext(compiled.outputText,sandbox,{filename:'lib/agent/open-loops.ts',timeout:1500})
  assert.equal(typeof mod.exports.readGmailAttention,'function')
  assert.equal(typeof mod.exports.userConnection,'function')
  return {functions:mod.exports,lookups,mailboxReads,tokenDecrypts}
}

let positives=0,safetyPass=0,safetyFail=0
async function control(name:string,fn:()=>Promise<void>){
  await fn();positives++;console.log('PASS CONTROL: '+name)
}
async function safety(name:string,fn:()=>Promise<void>){
  try{await fn();safetyPass++;console.log('PASS SAFETY: '+name)}
  catch(e:any){safetyFail++;console.error('FAIL SAFETY (expected until fixed): '+name+': '+(e?.message||e))}
}
function twoOwners(aEnabled=true,bEnabled=true,bConnected=true){
  const a=user('A'),b={...user('B'),gmail_connected:bConnected}
  return harness(new Map([[OWNER_A,a],[OWNER_B,b]]),
    new Map([[OWNER_A,{gmail_enabled:aEnabled}],[OWNER_B,{gmail_enabled:bEnabled}]]))
}
function acceptableFailClosed(e:unknown){
  return /(?:invalid_owner_identity|unsafe_owner_identity|owner_not_found|owner_identity_invalid|open_loop_owner_invalid|open_loop_gmail_owner_missing)/i.test(String((e as Error)?.message||e))
}

await control('safe integer owner reads exact mailbox only',async()=>{
  const h=harness(new Map([[SAFE,user('SAFE')]]),new Map([[SAFE,{gmail_enabled:true}]]))
  const r=await h.functions.readGmailAttention(SAFE)
  assert.equal(r.ownEmail,'safe@example.invalid')
  assert.deepEqual(h.mailboxReads,['FAKE_ACCESS_SAFE'])
  assert.equal(h.lookups.length,2)
  assert.ok(h.lookups.every(l=>String(l.value)===SAFE))
})
await control('disabled Gmail consent blocks a safe owner',async()=>{
  const h=harness(new Map([[SAFE,user('SAFE')]]),new Map([[SAFE,{gmail_enabled:false}]]))
  const r=await h.functions.readGmailAttention(SAFE)
  assert.equal(r.reason,'disabled')
  assert.equal(h.mailboxReads.length,0)
  assert.equal(h.tokenDecrypts.length,0)
})
await control('disconnected Gmail blocks a safe owner',async()=>{
  const h=harness(new Map([[SAFE,{...user('SAFE'),gmail_connected:false}]]),
    new Map([[SAFE,{gmail_enabled:true}]]))
  const r=await h.functions.readGmailAttention(SAFE)
  assert.equal(r.reason,'disconnected')
  assert.equal(h.mailboxReads.length,0)
})
await control('safe integer follow-up owner resolves own WhatsApp identity',async()=>{
  const h=harness(new Map([[SAFE,user('SAFE')]]),new Map())
  const r=await h.functions.userConnection(SAFE)
  assert.equal(r.whatsapp_id,user('SAFE').whatsapp_id)
})
await control('absent user never returns someone else follow-up identity',async()=>{
  const h=harness(new Map(),new Map())
  const r=await h.functions.userConnection(SAFE)
  assert.equal(r,null)
})

await safety('P1: adjacent 64-bit Gmail owner must not use first owners mailbox',async()=>{
  const h=twoOwners()
  try{
    const r=await h.functions.readGmailAttention(OWNER_B)
    assert.ok(!r.ownEmail||r.ownEmail==='b@example.invalid',
      'owner B received owner A email identity: '+r.ownEmail)
  }catch(e){if(!acceptableFailClosed(e))throw e}
  assert.ok(!h.mailboxReads.includes('FAKE_ACCESS_A'),
    'Gmail provider would receive another owner access token')
  assert.ok(!h.tokenDecrypts.includes('FAKE_ACCESS_A'),
    'wrong owner token was decrypted before Gmail read')
})
await safety('P1: explicit Gmail opt-out of owner B cannot inherit enabled owner A',async()=>{
  const h=twoOwners(true,false)
  try{
    const r=await h.functions.readGmailAttention(OWNER_B)
    assert.equal(r.reason,'disabled','owner B opted out of Gmail attention')
  }catch(e){if(!acceptableFailClosed(e))throw e}
  assert.equal(h.mailboxReads.length,0,'no mailbox can be read under owner B opt-out')
})
await safety('P1: unconnected owner B cannot inherit connected owner A',async()=>{
  const h=twoOwners(true,true,false)
  try{
    const r=await h.functions.readGmailAttention(OWNER_B)
    assert.equal(r.reason,'disconnected','owner B has no Gmail connection')
  }catch(e){if(!acceptableFailClosed(e))throw e}
  assert.equal(h.mailboxReads.length,0,'unconnected owner must not use an adjacent mailbox')
})
await safety('P1: follow-up owner B cannot inherit another owners WhatsApp number',async()=>{
  const h=twoOwners()
  try{
    const r=await h.functions.userConnection(OWNER_B)
    assert.ok(!r||r.whatsapp_id===user('B').whatsapp_id,
      'follow-up lookup selected another owners WhatsApp identity')
  }catch(e){if(!acceptableFailClosed(e))throw e}
})

console.log('CONTROLS='+positives+' SAFETY_PASS='+safetyPass+' SAFETY_FAIL='+safetyFail)
if(safetyFail)process.exitCode=1
