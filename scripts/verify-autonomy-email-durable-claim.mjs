// Synthetic-only durable proactive email safety regression.
// The real sendProactiveEmailCard AST is executed in a sealed VM.
// All accounts, database RPCs, WhatsApp provider SIDs, and email content are fictional.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file='lib/agent/autonomy-pulse.ts'
const source=readFileSync(file,'utf8')
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
const fnAst=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='sendProactiveEmailCard')
assert.ok(fnAst,'must execute actual production proactive email sender')
const compiled=ts.transpileModule(fnAst.getText(ast),{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText
const sql=readFileSync('supabase/migrations/20261102092000_autonomy_email_atomic_claim.sql','utf8')
const OWNER='-42'
const recipient={telegram_id:OWNER,whatsapp_id:'+919999000001',gmail_email:'owner@example.invalid'}
const makeEmail=(i)=>({
  loopId:'fictional-loop-'+i,threadId:'fictional-thread-'+i,score:0.99,category:'security',
  senderEmail:'sender@example.invalid',senderName:'Fictional Sender',
  why:'Synthetic review needed',ask:'Review fictional notice',
  email:{id:'fictional-message-'+i,from:'Sender <sender@example.invalid>',subject:'Fictional notice',snippet:'No real account content'},
})
const eligible=[1,2,3].map(i=>({
  id:'fictional-loop-'+i,kind:'commitment',title:'Fictional attention notice',
  summary:'Fictional summary',source_type:'gmail_thread',source_id:'fictional-thread-'+i,
  evidence_json:{},created_at:'2026-11-01T00:00:00Z',
}))

function harness(opts={}){
  const budget=new Map(),claims=new Map()
  const history=[...(opts.history||[])]
  let attempted=0,claimCalls=0,acceptedCalls=0,selection=0
  const sends=[],activityWrites=[],rpcCalls=[]
  const provider=async(phone,body)=>{
    assert.equal(phone,recipient.whatsapp_id,'fictional recipient only')
    sends.push({phone,body});attempted++
    if(opts.sendDelay)await new Promise(resolve=>setTimeout(resolve,20))
    if(opts.unknownFirst&&attempted===1)throw Error('fictional_unknown_provider_outcome')
    return opts.noSid?{}:{sid:'FAKE_PROVIDER_ACCEPTED_'+attempted}
  }
  const db={
    async rpc(name,args){
      rpcCalls.push({name,args})
      assert.ok(['claim_autonomy_email_card','finish_autonomy_email_card'].includes(name),'unexpected RPC')
      if(name==='claim_autonomy_email_card'){
        claimCalls++
        if(opts.claimError)return {data:null,error:{message:'fixture_schema_missing'}}
        assert.equal(String(args.p_owner),OWNER,'owner passed exactly, never rounded')
        assert.equal(args.p_day,'2026-11-02')
        assert.match(args.p_token,/^[a-z0-9-]+$/i)
        const keys=args.p_threads
        const previous=Math.max(budget.get(args.p_day)||0,args.p_prior_count||0)
        const unique=keys.length===new Set(keys).size && keys.every(k=>/^email:[A-Za-z0-9:_-]{1,190}$/.test(k))
        if(!unique||keys.some(k=>claims.has(k))||previous+keys.length>2)return {data:false,error:null}
        budget.set(args.p_day,previous+keys.length)
        keys.forEach(k=>claims.set(k,{token:args.p_token,state:'outcome_unknown'}))
        return {data:true,error:null}
      }
      acceptedCalls++
      if(opts.finishError)return {data:false,error:{message:'fixture_accepted_receipt_missing'}}
      let changed=0
      for(const claim of claims.values()){
        if(claim.token===args.p_token&&claim.state==='outcome_unknown'){
          claim.state='provider_accepted';claim.sid=args.p_provider_id;changed++
        }
      }
      return {data:changed>0,error:null}
    },
    from(table){
      assert.ok(['agent_open_loops','email_attention_rules','conversations','email_attention_events','agent_activity'].includes(table),'unexpected DB table')
      let action='read'
      const q={
        select(){return q},eq(){return q},in(){return q},order(){return q},limit(){return q},
        update(){action='update';return q},
        insert(row){
          if(table==='agent_activity'){
            assert.equal(row.telegram_id,OWNER)
            activityWrites.push(row)
            if(opts.activityError)return Promise.resolve({error:{message:'fixture_activity_failed'}})
            history.push({type:'autonomy_email_sent',at:'2026-11-02T09:30:00Z',
              keys:row.metadata_json.item_keys.map(String)})
          }
          if(table==='email_attention_events'&&opts.shownError)
            return Promise.resolve({error:{message:'fixture_shown_failed'}})
          return Promise.resolve({error:null})
        },
        then(resolve,reject){
          const data=action==='update'?[]:
            table==='agent_open_loops'?(opts.noMail?[]:eligible):
            table==='email_attention_rules'?[]:[]
          return Promise.resolve({data,error:null}).then(resolve,reject)
        }
      }
      return q
    }
  }
  const context={
    supabaseAdmin:db,
    randomUUID:()=>`00000000-0000-4000-8000-${String(++claimCalls).padStart(12,'0')}`,
    sendWhatsApp:provider,sendWhatsAppReminderTemplate:provider,
    recentSurfacedKeys:async()=>history.map(r=>({...r,keys:[...r.keys]})),
    allowedByTopic:()=>!opts.muted,
    topicForPulse:()=> 'open_loop',
    selectProactiveEmails:(_loops,state)=>{
      if(state.sentToday>=2)return []
      const emails=opts.twoInCard?[makeEmail(1),makeEmail(2)]:
        opts.alternate? [makeEmail(++selection)]:[makeEmail(1)]
      return emails.filter(e=>!state.alreadySurfaced.has('email:'+e.threadId))
    },
    formatProactiveEmailCard:()=> '📬 Fictional message',
    decodeHtmlEntities:value=>value,
    clean:(value,max)=>String(value??'').slice(0,max||500),
    ownerKey:value=>value,
    localDay:()=> '2026-11-02',
    Date,Set,Number,String,Promise,console
  }
  const run=vm.runInNewContext(compiled+'\n({sendProactiveEmailCard})',context,{timeout:1000}).sendProactiveEmailCard
  return {
    call:(r=recipient)=>run(OWNER,r,'Asia/Kolkata',{},true),
    sends,history,activityWrites,rpcCalls,claims,
    attempted:()=>attempted,claimsMade:()=>claims.size,accepts:()=>acceptedCalls,
    budget:()=>budget.get('2026-11-02')||0
  }
}

let controls=0,mandatory=0,fail=0
async function check(label,must,fn){
  try{await fn();console.log('PASS ['+(must?'MANDATORY':'CONTROL')+'] '+label);if(must)mandatory++;else controls++}
  catch(e){fail++;console.error('FAIL ['+(must?'MANDATORY':'CONTROL')+'] '+label+': '+(e?.stack||e))}
}

await check('owner-approved fictional email sends once with persisted receipt',false,async()=>{
  const h=harness(),result=await h.call()
  assert.equal(result.sent,true);assert.equal(h.attempted(),1);assert.equal(h.claimsMade(),1)
  assert.equal(h.accepts(),1);assert.equal(h.activityWrites.length,1)
})
await check('no eligible email means no claim and no send',false,async()=>{
  const h=harness({noMail:true});const result=await h.call()
  assert.equal(result.sent,false);assert.equal(h.attempted(),0);assert.equal(h.claimsMade(),0)
})
await check('user muted email means no claim',false,async()=>{
  const h=harness({muted:true});const result=await h.call()
  assert.equal(result.sent,false);assert.equal(h.attempted(),0)
})
await check('already surfaced message does not resend',false,async()=>{
  const h=harness();await h.call();const second=await h.call()
  assert.equal(second.sent,false);assert.equal(h.attempted(),1)
})
await check('two prior local-day email items block more cards',false,async()=>{
  const h=harness({history:[{type:'autonomy_email_sent',at:'2026-11-02T01:00:00Z',keys:['email:older-a','email:older-b']}]})
  assert.equal((await h.call()).sent,false);assert.equal(h.attempted(),0)
})

await check('activity write failure never reports a fully recorded send',true,async()=>{
  const h=harness({activityError:true});assert.equal((await h.call()).sent,false)
  assert.equal(h.attempted(),1);assert.equal(h.claimsMade(),1)
})
await check('activity write failure cannot trigger provider resend',true,async()=>{
  const h=harness({activityError:true});await h.call();await h.call()
  assert.equal(h.attempted(),1)
})
await check('two parallel workers targeting one thread can send at most once',true,async()=>{
  const h=harness({sendDelay:true});await Promise.all([h.call(),h.call()])
  assert.equal(h.attempted(),1);assert.equal(h.claimsMade(),1)
})
await check('one previous daily item plus two different parallel threads stays under two/day',true,async()=>{
  const h=harness({sendDelay:true,alternate:true,
    history:[{type:'autonomy_email_sent',at:'2026-11-02T00:00:00Z',keys:['email:older-z']}]})
  await Promise.all([h.call(),h.call()])
  assert.equal(h.attempted(),1);assert.equal(h.budget(),2)
})
await check('provider unknown outcome never retries on a subsequent cron invocation',true,async()=>{
  const h=harness({unknownFirst:true});const first=await h.call();const second=await h.call()
  assert.equal(first.sent,false);assert.equal(second.sent,false)
  assert.equal(h.attempted(),1);assert.equal(h.claimsMade(),1)
})
await check('failed provider acceptance persistence fences the thread',true,async()=>{
  const h=harness({finishError:true});const first=await h.call();await h.call()
  assert.equal(first.sent,false);assert.equal(h.attempted(),1);assert.equal(h.claimsMade(),1)
})
await check('provider accepted without SID remains outcome unknown and never retries',true,async()=>{
  const h=harness({noSid:true});assert.equal((await h.call()).sent,false);await h.call()
  assert.equal(h.attempted(),1)
})
await check('missing durable claim RPC fails closed before any send',true,async()=>{
  const h=harness({claimError:true});assert.equal((await h.call()).sent,false)
  assert.equal(h.attempted(),0)
})
await check('wrong-owner recipient is rejected before private email read or claim',true,async()=>{
  const h=harness();const r={...recipient,telegram_id:'-99'}
  assert.equal((await h.call(r)).sent,false);assert.equal(h.attempted(),0);assert.equal(h.rpcCalls.length,0)
})
await check('failed chat-to-email card mapping does not claim verified sent or retry',true,async()=>{
  const h=harness({shownError:true});assert.equal((await h.call()).sent,false);await h.call()
  assert.equal(h.attempted(),1)
})
await check('one two-item card reserves full daily budget',true,async()=>{
  const h=harness({twoInCard:true});assert.equal((await h.call()).sent,true)
  assert.equal(h.claimsMade(),2);assert.equal(h.budget(),2);assert.equal(h.attempted(),1)
})
await check('SQL migration retains atomic unique owner/thread and owner/day cap with service-only RPCs',true,async()=>{
  assert.match(sql,/primary key\s*\(owner_id,\s*thread_key\)/i)
  assert.match(sql,/primary key\s*\(owner_id,\s*local_day\)/i)
  assert.match(sql,/reserved_items\s*=\s*greatest\(reserved_items,\s*p_prior_count\)\s*\+\s*n/i)
  assert.match(sql,/on conflict do nothing/i)
  assert.match(sql,/raise exception 'autonomy_email_duplicate_claim'/i)
  assert.match(sql,/security invoker set search_path='' /i)
  assert.match(sql,/revoke all on function public\.claim_autonomy_email_card/i)
  assert.match(sql,/grant execute on function public\.claim_autonomy_email_card/i)
  assert.match(sql,/state text not null default 'outcome_unknown'/i)
})

console.log(`AUTONOMY_EMAIL_DURABLE_CLAIM: controls=${controls}/5, mandatory=${mandatory}/12, failures=${fail}; all DB/WhatsApp/owners fictional; live PostgreSQL/recipient acceptance not tested`)
if(fail)process.exitCode=1
