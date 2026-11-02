// Original-source appointment-confirmation Gmail owner/consent regression.
// Fictional records, no network, database, Gmail, model or provider execution.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/agent/appointment-auth-resume.ts'
const source=fs.readFileSync(path,'utf8')
function loadActualFunction(name,deps) {
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)
  assert.ok(fn,'actual source function missing: '+name)
  const js=ts.transpileModule(fn.getText(ast)+'\nmodule.exports={'+name+'};',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}}
  vm.runInNewContext(js,{module,exports:module.exports,console,...deps},{timeout:2000,filename:path})
  return module.exports[name]
}

const OWNER=123456789, USER='fictional-uuid-owner-123'
const state={
  consent:{telegram_id:OWNER,gmail_enabled:true},consentError:false,
  user:{id:USER,telegram_id:OWNER,gmail_connected:true,gmail_access_token:'fictional-access',gmail_refresh_token:'',timezone:'Asia/Kolkata'},
  userError:false,queries:[],decryptions:0,refreshes:0,
}
const db={from(table){
  assert.ok(['user_consent_settings','users'].includes(table),'no other table allowed: '+table)
  const q={table,fields:'',filters:[],
    select(fields){this.fields=fields;return this},
    eq(k,v){this.filters.push([k,String(v)]);return this},
    async maybeSingle(){
      state.queries.push({table:this.table,fields:this.fields,filters:this.filters})
      const map=new Map(this.filters)
      assert.equal(map.get('telegram_id'),String(OWNER),'tenant query must bind exact owner, never a rounded owner')
      if(this.table==='user_consent_settings')return {data:state.consent,error:state.consentError?{message:'fictional-consent-db-unavailable'}:null}
      assert.equal(map.get('id'),USER,'credential query must also bind actor users.id')
      assert.match(this.fields,/id,telegram_id/, 'users row must include returned exact identities')
      return {data:state.user,error:state.userError?{message:'fictional-owner-db-unavailable'}:null}
    },
  }
  return q
}}
const actual=loadActualFunction('gmailToken',{
  supabaseAdmin:db,
  decryptGoogleToken(value){state.decryptions++;return String(value||'')},
  async refreshGmailAccessToken(token){state.refreshes++;assert.equal(token,'fictional-refresh-token');return 'fictional-refreshed-access'},
})
const actor=(owner=OWNER,userId=USER)=>({legacyTelegramId:owner,userId,whatsappId:'whatsapp:+15550000000',name:'Synthetic'})
const snap=()=>({reads:state.queries.length,dec:state.decryptions,refresh:state.refreshes})
let benign=0,mandatory=0
async function check(kind,label,fn){
  await fn();if(kind==='BENIGN')benign++;else mandatory++
  console.log(kind+': '+label)
}
await check('BENIGN','affirmative saved consent and exact linked user permit credential read',async()=>{
  const b=snap(),out=await actual(actor())
  assert.equal(out?.access,'fictional-access')
  assert.equal(out?.timezone,'Asia/Kolkata')
  assert.equal(state.queries.length-b.reads,2)
  assert.deepEqual(state.queries.slice(-2).map(x=>x.table),['user_consent_settings','users'],
    'consent must precede credentials')
  assert.equal(state.decryptions-b.dec,2)
})
await check('BENIGN','signed negative WhatsApp owner is preserved without Number rounding',async()=>{
  const old=OWNER
  const neg=-2251799813685248
  state.consent={telegram_id:neg,gmail_enabled:true};state.user={...state.user,telegram_id:neg}
  try{
    // The mock binds safe negative owner when explicitly switched.
    const orig=String(OWNER)
    const reads=state.queries.length
    const out=await actual(actor(neg))
    assert.equal(out?.access,'fictional-access')
    assert.ok(state.queries.slice(reads).every(q=>q.filters.some(([k,v])=>k==='telegram_id'&&v===String(neg))))
  }finally{state.consent={telegram_id:old,gmail_enabled:true};state.user={...state.user,telegram_id:old}}
})
await check('BENIGN','affirmative consent but disconnected account does not decrypt',async()=>{
  state.user={...state.user,gmail_connected:false}
  const b=snap(),out=await actual(actor())
  assert.equal(out,null);assert.equal(state.decryptions,b.dec)
  state.user={...state.user,gmail_connected:true}
})
await check('BENIGN','affirmative consent preserves existing refresh-token path',async()=>{
  state.user={...state.user,gmail_access_token:'',gmail_refresh_token:'fictional-refresh-token'}
  const b=snap(),out=await actual(actor())
  assert.equal(out?.access,'fictional-refreshed-access')
  assert.equal(state.refreshes-b.refresh,1)
  state.user={...state.user,gmail_access_token:'fictional-access',gmail_refresh_token:''}
})

for(const value of [false,null,undefined,'missing']){
  await check('MANDATORY','missing/disabled/null consent never reads Gmail tokens: '+String(value),async()=>{
    state.consent=value==='missing'?null:{telegram_id:OWNER,gmail_enabled:value}
    const b=snap(),out=await actual(actor())
    assert.equal(out,null)
    assert.equal(state.queries.length-b.reads,1,'only owner-bound consent query allowed')
    assert.equal(state.queries.at(-1).table,'user_consent_settings')
    assert.equal(state.decryptions,b.dec);assert.equal(state.refreshes,b.refresh)
  })
}
state.consent={telegram_id:OWNER,gmail_enabled:true}
await check('MANDATORY','consent storage failure never falls through to credentials',async()=>{
  state.consentError=true;const b=snap()
  await assert.rejects(()=>actual(actor()),/appointment_gmail_consent_failed/)
  assert.equal(state.queries.length-b.reads,1)
  assert.equal(state.decryptions,b.dec)
  state.consentError=false
})
await check('MANDATORY','consent row from a different owner must fail closed',async()=>{
  state.consent={telegram_id:OWNER+1,gmail_enabled:true}
  const b=snap(),out=await actual(actor())
  assert.equal(out,null)
  assert.equal(state.queries.length-b.reads,1)
  assert.equal(state.decryptions,b.dec)
  state.consent={telegram_id:OWNER,gmail_enabled:true}
})
for(const unsafe of [0,1.5,NaN,Infinity,9007199254740992,-9007199254740992]){
  await check('MANDATORY','unsafe or already-rounded numeric actor blocked before query: '+String(unsafe),async()=>{
    const b=snap(),out=await actual(actor(unsafe))
    assert.equal(out,null)
    assert.deepEqual(snap(),b)
  })
}
await check('MANDATORY','missing actor UUID cannot access connected mailbox',async()=>{
  const b=snap(),out=await actual(actor(OWNER,''))
  assert.equal(out,null);assert.deepEqual(snap(),b)
})
await check('MANDATORY','returned connected Gmail user UUID must match actor',async()=>{
  state.user={...state.user,id:'fictional-OTHER-uuid'}
  const b=snap(),out=await actual(actor())
  assert.equal(out,null);assert.equal(state.decryptions,b.dec)
  state.user={...state.user,id:USER}
})
await check('MANDATORY','returned connected Gmail user telegram ID must match actor',async()=>{
  state.user={...state.user,telegram_id:OWNER+1}
  const b=snap(),out=await actual(actor())
  assert.equal(out,null);assert.equal(state.decryptions,b.dec)
  state.user={...state.user,telegram_id:OWNER}
})
await check('MANDATORY','failed credential lookup never decrypts or refreshes',async()=>{
  state.userError=true;const b=snap()
  await assert.rejects(()=>actual(actor()),/appointment_gmail_credentials_failed/)
  assert.equal(state.decryptions,b.dec);assert.equal(state.refreshes,b.refresh)
  state.userError=false
})
assert.match(source,/findAppointmentEmail\(params\.actor,selection\)/,
  'appointment confirmation consumer must retain shared verified Gmail boundary')
assert.match(source,/const creds = await gmailToken\(actor\)/,
  'appointment confirmation reader must still call checked token helper')
console.log('PASS: '+benign+' benign controls and '+mandatory+' mandatory original-source appointment Gmail privacy checks; fictional inputs only')
