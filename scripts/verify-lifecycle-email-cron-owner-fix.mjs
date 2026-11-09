// Original-source lifecycle-email cron isolation regression. ONLY fictional rows,
// fake Supabase, fake Resend, and fake unsubscribe renderer. NO real sends or HTTP.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('app/api/cron/lifecycle-emails/route.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const A='9007199254740992', B='9007199254740993'
function fixtureUser(owner,extra={}) {
  return {
    telegram_id:owner,name:'Synthetic Person',
    email:'synthetic@example.invalid',
    email_captured_at:'2026-01-01T00:00:00.000Z',
    email_opt_out:false,...extra,
  }
}
async function exercise(opts={}) {
  const reads=[],inserts=[],sends=[],tokens=[]
  const db={
    from(table) {
      assert.ok(table==='users'||table==='lifecycle_email_log','unexpected database table '+table)
      const f={}
      const q={
        select(fields){f.fields=fields;return q},
        not(key,operator,value){f.not=[key,operator,value];return q},
        eq(key,value){f[key]=value;return q},
        order(){return q},
        limit(){return q},
        then(ok,bad){
          reads.push({table,fields:f.fields,owner:f.telegram_id})
          const result=table==='users'
            ? {data:opts.users??[fixtureUser('42')],error:opts.usersError??null}
            : {data:opts.logRows??[],error:opts.logError??null}
          return Promise.resolve(result).then(ok,bad)
        },
        insert(row){
          assert.equal(table,'lifecycle_email_log','unexpected DB write')
          inserts.push(row)
          return Promise.resolve({error:opts.insertError??null})
        },
      }
      return q
    },
  }
  const deps={
    'next/server':{
      NextResponse:{json:(body,config)=>({body,status:config?.status??200})},
    },
    '@/lib/security/cron-auth':{isCronAuthorized:()=>true},
    '@/lib/supabase-admin':{supabaseAdmin:db},
    '@/lib/email/lifecycle':{
      LIFECYCLE_EMAILS:[{day:0,key:'welcome'}],
      renderLifecycleEmail:({email,firstName,unsubscribeUrl})=>({
        subject:'Synthetic '+email.key+' '+firstName,
        html:'Synthetic HTML '+unsubscribeUrl,
        text:'Synthetic text '+unsubscribeUrl,
      }),
    },
    '@/lib/email/resend':{
      sendAskGogoEmail:async input=>{
        sends.push(input)
        return {ok:true,id:'synthetic-resend-'+sends.length}
      },
    },
    '@/lib/email/unsubscribe':{
      buildUnsubscribeUrl:(owner,email)=>{
        tokens.push({owner,email})
        return 'https://example.invalid/fictional-unsubscribe'
      },
    },
  }
  const exports={}
  vm.runInNewContext(compiled,{
    exports,console,URL,Date,BigInt,Number,String,Set,Promise,
    require:(name)=>{
      assert.ok(Object.hasOwn(deps,name),'unexpected module import: '+name)
      return deps[name]
    },
  },{timeout:2000})
  assert.equal(typeof exports.GET,'function')
  const req={url:'https://app.askgogo.in/api/cron/lifecycle-emails'+(opts.dry?'?dry=1':'')}
  const res=await exports.GET(req)
  return {res,reads,inserts,sends,tokens}
}
let controls=0,mandatory=0,failed=0
async function check(title,isMandatory,fn){
  try{await fn();if(isMandatory)mandatory++;else controls++;console.log('PASS ['+(isMandatory?'MANDATORY':'CONTROL')+'] '+title)}
  catch(error){failed++;console.error('FAIL ['+(isMandatory?'MANDATORY':'CONTROL')+'] '+title+': '+(error?.stack||error))}
}
const ownerReads=result=>result.reads.filter(x=>x.table==='lifecycle_email_log')
await check('safe positive string sends and receipts to same owner',false,async()=>{
  const x=await exercise({users:[fixtureUser('42')]})
  assert.equal(x.res.body.sent,1)
  assert.equal(x.sends.length,1)
  assert.equal(ownerReads(x)[0].owner,'42')
  assert.equal(x.inserts[0].telegram_id,'42')
  assert.equal(x.tokens[0].owner,'42')
  assert.equal(x.sends[0].idempotencyKey,'lifecycle/42/welcome')
})
await check('safe negative WhatsApp owner is accepted',false,async()=>{
  const x=await exercise({users:[fixtureUser('-42')]})
  assert.equal(x.res.body.sent,1)
  assert.equal(ownerReads(x)[0].owner,'-42')
  assert.equal(x.inserts[0].telegram_id,'-42')
})
await check('safe numeric owner is canonicalized exactly',false,async()=>{
  const x=await exercise({users:[fixtureUser(42)]})
  assert.equal(x.res.body.sent,1)
  assert.equal(ownerReads(x)[0].owner,'42')
})
await check('email opt-out suppresses private read and sends',false,async()=>{
  const x=await exercise({users:[fixtureUser('42',{email_opt_out:true})]})
  assert.equal(x.sends.length,0)
  assert.equal(ownerReads(x).length,0)
  assert.equal(x.res.body.skipped,1)
})
await check('dry run retains candidate but never sends or persists',false,async()=>{
  const x=await exercise({users:[fixtureUser('42')],dry:true})
  assert.equal(x.sends.length,0)
  assert.equal(x.inserts.length,0)
  assert.equal(x.res.body.candidates[0].telegramId,'42')
})
await check('already sent lifecycle step is not sent again',false,async()=>{
  const x=await exercise({users:[fixtureUser('42')],logRows:[{telegram_id:'42',email_key:'welcome',sent_at:'2026-01-02T00:00:00Z'}]})
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.skipped,1)
})
await check('log storage error suppresses sends',false,async()=>{
  const x=await exercise({users:[fixtureUser('42')],logError:{message:'synthetic-db-fail'}})
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.failures.length,1)
})
await check('adjacent 64-bit owner B never queries owner A log',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)]})
  assert.equal(ownerReads(x)[0].owner,B)
  assert.notEqual(ownerReads(x)[0].owner,A)
  assert.equal(x.res.body.sent,1)
})
await check('adjacent large identities create different receipt keys and claims',true,async()=>{
  const x=await exercise({users:[fixtureUser(A,{email:'a@example.invalid'}),fixtureUser(B,{email:'b@example.invalid'})]})
  assert.equal(x.res.body.sent,2)
  assert.equal(ownerReads(x).length,2)
  assert.equal(ownerReads(x)[0].owner,A)
  assert.equal(ownerReads(x)[1].owner,B)
  assert.equal(x.inserts[0].telegram_id,A)
  assert.equal(x.inserts[1].telegram_id,B)
  assert.notEqual(x.sends[0].idempotencyKey,x.sends[1].idempotencyKey)
})
await check('negative exact 64-bit owner stays exact',true,async()=>{
  const n='-9007199254740993'
  const x=await exercise({users:[fixtureUser(n)]})
  assert.equal(x.res.body.sent,1)
  assert.equal(ownerReads(x)[0].owner,n)
  assert.equal(x.inserts[0].telegram_id,n)
})
await check('already-rounded unsafe JS numbers never perform private lookups',true,async()=>{
  const x=await exercise({users:[fixtureUser(9007199254740992),fixtureUser(-9007199254740992)]})
  assert.equal(ownerReads(x).length,0)
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.skipped,2)
})
await check('noncanonical and missing owner input never authorizes a send',true,async()=>{
  const bad=['0','-0','0042','+42','42 ',' 42','1e2','12.0','12.3','',null,undefined,{},false]
  const x=await exercise({users:bad.map(value=>fixtureUser(value))})
  assert.equal(ownerReads(x).length,0)
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.skipped,bad.length)
})
await check('signed int64 overflows never perform private history lookup',true,async()=>{
  const bad=['9223372036854775808','-9223372036854775809','9999999999999999999']
  const x=await exercise({users:bad.map(value=>fixtureUser(value))})
  assert.equal(ownerReads(x).length,0)
  assert.equal(x.sends.length,0)
})
await check('returned lifecycle log from different owner cannot authorize delivery',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)],logRows:[{telegram_id:A,email_key:'different',sent_at:'2026-01-02T00:00:00Z'}]})
  assert.equal(x.sends.length,0)
  assert.equal(x.inserts.length,0)
  assert.equal(x.res.body.failures[0].telegramId,B)
  assert.match(x.res.body.failures[0].error,/owner_verification_failed/)
})
await check('unsafe numeric database owner echo is refused',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)],logRows:[{telegram_id:9007199254740992,email_key:'different',sent_at:'2026-01-02T00:00:00Z'}]})
  assert.equal(x.sends.length,0)
  assert.equal(x.inserts.length,0)
  assert.equal(x.res.body.failures[0].telegramId,B)
})
await check('ownerless log rows cannot authorize email even if unrelated',true,async()=>{
  const x=await exercise({users:[fixtureUser('42')],logRows:[{email_key:'other',sent_at:'2026-01-02T00:00:00Z'}]})
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.failures.length,1)
})
await check('unsubscribe token uses precise owner, not rounded alias',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)]})
  assert.equal(x.tokens[0].owner,B)
  assert.equal(x.tokens[0].email,'synthetic@example.invalid')
  assert.equal(x.sends[0].unsubscribeUrl,'https://example.invalid/fictional-unsubscribe')
})
await check('provider idempotency key retains exact owner',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)]})
  assert.equal(x.sends[0].idempotencyKey,'lifecycle/'+B+'/welcome')
})
await check('provider receipt is persisted under the original exact owner',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)]})
  assert.equal(x.inserts[0].telegram_id,B)
  assert.equal(x.inserts[0].provider_message_id,'synthetic-resend-1')
})
await check('DB read errors report the exact 64-bit owner and make no send',true,async()=>{
  const x=await exercise({users:[fixtureUser(B)],logError:{message:'synthetic-provider-unavailable'}})
  assert.equal(x.sends.length,0)
  assert.equal(x.res.body.failures[0].telegramId,B)
})
console.log('LIFECYCLE_EMAIL_EXACT_OWNER_FIX '+JSON.stringify({controls,mandatory,failed,synthetic:true}))
if(failed!==0||controls!==7||mandatory!==13)process.exitCode=1
