// Sealed original-source Gmail Send credential/owner/privacy regression.
// Fictional actors, tokens, database rows. No network, real Gmail, credentials,
// approval actions, sends or provider side effects.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/agent/gmail-send.ts'
const source=fs.readFileSync(path,'utf8')
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='gmailAccess')
assert.ok(fn,'must test original unmodified Gmail credential entrypoint')
const js=ts.transpileModule(fn.getText(ast)+'\nmodule.exports={gmailAccess};',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText

const OWNER=123456789, UUID='fictional-gmail-owner-uuid'
const state={
  consent:{telegram_id:OWNER,gmail_enabled:true},
  user:{id:UUID,telegram_id:OWNER,gmail_connected:true,gmail_send_connected:true,gmail_email:'alice@example.test',
    gmail_access_token:'fixture-access',gmail_refresh_token:''},
  consentError:false,userError:false,owner:String(OWNER),queries:[],decryptions:0,refreshes:0,
}
function reset(){
  state.consent={telegram_id:OWNER,gmail_enabled:true}
  state.user={id:UUID,telegram_id:OWNER,gmail_connected:true,gmail_send_connected:true,gmail_email:'alice@example.test',gmail_access_token:'fixture-access',gmail_refresh_token:''}
  state.consentError=false;state.userError=false;state.owner=String(OWNER);state.queries=[];state.decryptions=0;state.refreshes=0
}
const db={from(table){
  assert.ok(table==='users'||table==='user_consent_settings','unexpected private table '+table)
  const query={table,fields:'',filters:[],
    select(fields){this.fields=fields;return this},
    eq(key,value){this.filters.push([key,String(value)]);return this},
    async maybeSingle(){
      state.queries.push({table:this.table,fields:this.fields,filters:this.filters})
      const map=new Map(this.filters)
      assert.equal(map.get('telegram_id'),state.owner,'query must preserve exact synthetic owner')
      if(this.table==='user_consent_settings')
        return {data:state.consent,error:state.consentError?{message:'fixture_consent_failure'}:null}
      assert.equal(map.get('id'),UUID,'credential row must bind actor user UUID')
      return {data:state.user,error:state.userError?{message:'fixture_user_failure'}:null}
    },
  }
  return query
}}
const module={exports:{}}
vm.runInNewContext(js,{module,exports:module.exports,supabaseAdmin:db,
  decryptGoogleToken(value){state.decryptions++;return String(value||'')},
  async refreshGmailAccessToken(value){state.refreshes++;assert.equal(value,'fixture-refresh');return 'fixture-refreshed-access'},
},{timeout:2500,filename:path})
const actual=module.exports.gmailAccess
assert.equal(typeof actual,'function')
const actor=(owner=OWNER,userId=UUID)=>({legacyTelegramId:owner,userId,name:'Fictional',whatsappId:'whatsapp:+15550000000'})
const snapshot=()=>({reads:state.queries.length,decryptions:state.decryptions,refreshes:state.refreshes})
let benign=0,mandatory=0
async function check(kind,name,fn){
  reset()
  await fn()
  if(kind==='BENIGN')benign++;else mandatory++
  console.log(kind+': '+name)
}
await check('BENIGN','affirmative owner-bound Gmail read yields decrypted fixture token',async()=>{
  const out=await actual(actor())
  assert.equal(out.ok,true);assert.equal(out.accessToken,'fixture-access');assert.equal(state.decryptions,2)
  assert.equal(state.queries.length,2)
})
await check('BENIGN','affirmative and Send-connected owner may access existing approved-send token path',async()=>{
  const out=await actual(actor(),{requireSend:true})
  assert.equal(out.ok,true);assert.equal(out.accessToken,'fixture-access')
})
await check('BENIGN','valid signed negative WhatsApp actor is preserved',async()=>{
  const negative=-2251799813685248
  state.owner=String(negative);state.consent.telegram_id=negative;state.user.telegram_id=negative
  const out=await actual(actor(negative),{requireSend:true})
  assert.equal(out.ok,true)
  assert.ok(state.queries.every(q=>new Map(q.filters).get('telegram_id')===String(negative)))
})
await check('BENIGN','connected account without Send scope stays read-only',async()=>{
  state.user.gmail_send_connected=false
  const out=await actual(actor(),{requireSend:true})
  assert.equal(out.ok,false);assert.equal(out.reason,'gmail_send_not_connected')
  assert.equal(state.decryptions,0)
})
await check('BENIGN','disconnected user never decrypts connected tokens',async()=>{
  state.user.gmail_connected=false
  const out=await actual(actor())
  assert.equal(out.ok,false);assert.equal(state.decryptions,0)
})
await check('BENIGN','authorized refresh-token recovery remains possible',async()=>{
  state.user.gmail_access_token='';state.user.gmail_refresh_token='fixture-refresh'
  const out=await actual(actor())
  assert.equal(out.ok,true);assert.equal(out.accessToken,'fixture-refreshed-access')
  assert.equal(state.refreshes,1)
})
await check('MANDATORY','consent is fetched before any credential-bearing users row, with exact identities',async()=>{
  const out=await actual(actor());assert.equal(out.ok,true)
  assert.equal(state.queries.map(q=>q.table).join(','),'user_consent_settings,users')
  const [consent,user]=state.queries
  assert.match(consent.fields,/telegram_id,gmail_enabled/)
  assert.match(user.fields,/id,telegram_id/)
  assert.equal(new Map(user.filters).get('id'),UUID)
})
for(const val of ['missing',false,null,undefined]){
  await check('MANDATORY','disabled/missing/NULL consent blocks all Gmail credentials: '+String(val),async()=>{
    state.consent=val==='missing'?null:{telegram_id:OWNER,gmail_enabled:val}
    const out=await actual(actor())
    assert.equal(out.ok,false);assert.equal(out.reason,'gmail_read_disabled')
    assert.equal(state.queries.length,1,'no users token query when consent absent')
    assert.equal(state.decryptions,0);assert.equal(state.refreshes,0)
  })
}
await check('MANDATORY','revocation blocks even a previously approved Send path',async()=>{
  state.consent.gmail_enabled=false
  const out=await actual(actor(),{requireSend:true})
  assert.equal(out.ok,false);assert.equal(state.queries.length,1);assert.equal(state.decryptions,0)
})
await check('MANDATORY','consent store failure fails closed before tokens',async()=>{
  state.consentError=true
  await assert.rejects(()=>actual(actor()),/gmail_send_consent_read_failed/)
  assert.equal(state.queries.length,1);assert.equal(state.decryptions,0)
})
await check('MANDATORY','returned consent row must match exact actor ID',async()=>{
  state.consent.telegram_id=OWNER+1
  const out=await actual(actor());assert.equal(out.ok,false)
  assert.equal(state.queries.length,1);assert.equal(state.decryptions,0)
})
for(const unsafe of [0,1.5,NaN,Infinity,9007199254740992,-9007199254740992]){
  await check('MANDATORY','unsafe or rounded legacy owner performs no private lookup: '+String(unsafe),async()=>{
    const out=await actual(actor(unsafe))
    assert.equal(out.ok,false);assert.equal(out.reason,'gmail_owner_invalid')
    assert.deepEqual(snapshot(),{reads:0,decryptions:0,refreshes:0})
  })
}
await check('MANDATORY','missing owner UUID performs no consent or private lookup',async()=>{
  const out=await actual(actor(OWNER,''))
  assert.equal(out.ok,false);assert.deepEqual(snapshot(),{reads:0,decryptions:0,refreshes:0})
})
await check('MANDATORY','mismatched returned user UUID cannot decrypt Gmail',async()=>{
  state.user.id='other-account-uuid'
  const out=await actual(actor());assert.equal(out.ok,false);assert.equal(out.reason,'gmail_owner_invalid');assert.equal(state.decryptions,0)
})
await check('MANDATORY','mismatched returned user telegram ID cannot decrypt Gmail',async()=>{
  state.user.telegram_id=OWNER+1
  const out=await actual(actor());assert.equal(out.ok,false);assert.equal(out.reason,'gmail_owner_invalid');assert.equal(state.decryptions,0)
})
await check('MANDATORY','credential table failure cannot proceed to decryption or provider',async()=>{
  state.userError=true
  await assert.rejects(()=>actual(actor()),/gmail_send_user_read_failed/)
  assert.equal(state.decryptions,0);assert.equal(state.refreshes,0)
})
assert.match(source,/async function resolveThread[\s\S]*?gmailAccess\(actor\)/,
  'draft recipient selection must keep checked owner/consent token helper')
assert.match(source,/export async function executeApprovedGmailSend[\s\S]*?assertApprovalBinding\(/,
  'send must retain approval fingerprint matching')
assert.match(source,/export async function executeApprovedGmailSend[\s\S]*?gmailAccess\(params\.actor,\{requireSend:true\}\)/,
  'approved mutation must recheck owner/consent immediately before provider send')
assert.match(source,/agent_run_already_claimed/,'unknown/claimed execution must never blindly retry')
assert.match(source,/status:'outcome_unknown'/,'unknown provider outcome must remain durable')
console.log('PASS: '+benign+' benign controls and '+mandatory+' mandatory synthetic Gmail consent/owner safety assertions; no provider calls')
