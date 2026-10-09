// Core v1 external-account acceptance — AUTOMATED, MOCKED.
// Runs the REAL objective flow (lib/agent/external-account.ts) and the REAL post-auth
// outcome verifier against an in-memory store. No browser is started, no provider is
// contacted, no account is created. Live provider behaviour is NOT proven here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vaultProviders from '../lib/vault/providers.ts'
import * as accountIntent from '../lib/agent/external-account-intent.ts'
import { detectHumanAuthGate } from '../lib/agent/browser-auth-gate.ts'
import { redactBrowserSensitiveText } from '../lib/agent/secure-browser-redaction.ts'
import { classifyAgentRequest } from '../lib/agent/classifier.ts'

const transpile=(path:string)=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText

// ---------------------------------------------------------------- harness
function makeWorld(){
  const memories:any[]=[]
  const conversations:any[]=[]
  const commands:any[]=[]
  let clock=Date.parse('2026-10-09T06:00:00.000Z')
  let seq=0
  const stamp=()=>new Date(clock+(seq++)).toISOString()
  const state={failReads:false,browserThrows:false}
  class FakeDate extends Date{
    constructor(...args:any[]){if(args.length)super(args[0]);else super(clock)}
    static now(){return clock}
  }
  const table=(name:string)=>name==='memories'?memories:name==='conversations'?conversations:null
  const db={from(name:string){
    const rows=table(name)
    if(!rows)throw new Error('unexpected table in account flow: '+name)
    const preds:Array<(r:any)=>boolean>=[]
    let max=Infinity
    const q:any={
      select(){return q},
      eq(k:string,v:any){preds.push((r:any)=>r[k]===v);return q},
      order(){return q},
      limit(n:number){max=n;return q},
      insert(values:any){for(const v of [].concat(values))rows.push({...v,created_at:stamp()});return Promise.resolve({data:null,error:null})},
      then(ok:any,bad:any){
        if(state.failReads)return Promise.reject(new Error('injected read failure')).then(ok,bad)
        const out=rows.filter(r=>preds.every(p=>p(r))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,max)
        return Promise.resolve({data:out,error:null}).then(ok,bad)
      },
    }
    return q
  }}
  const followup={
    async saveFollowupState(telegramId:number,kind:string,payload:any){
      memories.push({telegram_id:telegramId,content:JSON.stringify({type:'followup_state',kind,payload,created_at:new Date(clock).toISOString()}),created_at:stamp()})
    },
    async clearFollowupState(telegramId:number,kind:string){
      for(let i=memories.length-1;i>=0;i--){
        try{const c=JSON.parse(memories[i].content);if(memories[i].telegram_id===telegramId&&c.type==='followup_state'&&c.kind===kind)memories.splice(i,1)}catch{}
      }
    },
  }
  const flow:any={}
  runInNewContext(transpile('lib/agent/external-account.ts'),{
    exports:flow,console,URL,Date:FakeDate,require(name:string){
      if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
      if(name==='@/lib/bot/handlers/followup-state')return followup
      if(name==='@/lib/vault/providers')return vaultProviders
      if(name==='./external-account-intent')return accountIntent
      if(name==='./browser-command')return {runBrowserCommand:async(params:any)=>{
        if(state.browserThrows)throw new Error('sandbox_create_failed: provider internal 503 at bom1')
        commands.push(params)
        return {runId:`run-${commands.length}`,status:'waiting_approval',capability:'browser',risk:'high',text:'secure-browser approval prompt',approvalId:`ap-${commands.length}`,approvalRequired:true,handledBy:'secure-browser'}
      }}
      throw new Error('unexpected external-account dependency: '+name)
    },
  })
  // Mirrors both surfaces: the turn is persisted AFTER the flow answers.
  async function send(telegramId:number,text:string,surface='whatsapp'){
    const result=await flow.tryRunExternalAccountFlow({actor:{legacyTelegramId:telegramId},surface,text})
    conversations.push({telegram_id:telegramId,role:'user',content:text,created_at:stamp()})
    if(result)conversations.push({telegram_id:telegramId,role:'assistant',content:result.text,created_at:stamp()})
    return result
  }
  const pendingFor=(telegramId:number)=>memories.filter(m=>m.telegram_id===telegramId&&m.content.includes('external_account_create'))
  return {flow,send,commands,memories,conversations,state,pendingFor,advanceMinutes:(m:number)=>{clock+=m*60_000}}
}

// ---------------------------------------------------------------- Test 1: exact Hugging Face objective
{
  const w=makeWorld()
  const ask=await w.send(42,'Login to huggingface and create a account for me..')
  assert.equal(ask.status,'paused','objective is persisted and waits only for missing input')
  assert.equal(ask.handledBy,'external-account-objective')
  assert.match(ask.text,/Which email should I use for the Hugging Face account\?/,'asks only for the missing non-secret input, using the provider name')
  assert.doesNotMatch(ask.text,/password|otp|browser access|can't|cannot/i,'never asks for secrets and never claims browser access is unavailable')
  assert.equal(w.commands.length,0,'nothing executes before the email is known')
  assert.equal(w.pendingFor(42).length,1,'the objective is persisted as a pending follow-up')

  const ready=await w.send(42,'gogo@example.com')
  assert.equal(w.commands.length,1,'the email resumes the same objective and starts exactly one browser run')
  const cmd=w.commands[0].command
  assert.equal(cmd.url,'https://huggingface.co/join','navigates to the verified official signup destination')
  assert.equal(cmd.mode,'execute')
  assert.equal(cmd.risk,'high')
  assert.equal(cmd.approvalAction,'submit_form','account submission stays behind explicit approval')
  assert.equal(cmd.flow,'account_creation')
  assert.match(cmd.objective,/gogo@example\.com/)
  assert.match(cmd.objective,/Only claim success after the provider visibly confirms/)
  assert.match(cmd.objective,/Pause for Take Control/)
  assert.match(cmd.objective,/Vault/)
  assert.equal(ready.status,'waiting_approval','consequential submission requests explicit approval')
  assert.match(ready.text,/APPROVE/)
  assert.match(ready.text,/huggingface\.co/,'the approval prompt shows the exact destination host')
  assert.doesNotMatch(ready.text,/\b(?:created|done|completed)\b/i,'nothing is reported as created before provider verification')
  assert.equal(w.pendingFor(42).length,0,'the answered follow-up is consumed')

  const again=await w.send(42,'gogo@example.com')
  assert.equal(again,null,'a duplicated email after resumption does not start a second run')
  assert.equal(w.commands.length,1,'safe retry: still exactly one run')
}

// ---------------------------------------------------------------- Test 2: same objective across surfaces
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face','whatsapp')
  const web=await w.send(42,'gogo@example.com','web')
  assert.equal(web.status,'waiting_approval','an objective started on WhatsApp resumes from the web surface')
  assert.equal(w.commands.length,1)
  assert.equal(w.commands[0].surface,'web','the resumed run is attributed to the surface that answered')
}

// ---------------------------------------------------------------- Test 5: binding and isolation
{
  const w=makeWorld()
  assert.equal(await w.send(42,'gogo@example.com'),null,'an email with no pending objective is not an account request')
  assert.equal(w.commands.length,0)
}
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  w.advanceMinutes(31)
  assert.equal(await w.send(42,'gogo@example.com'),null,'an expired objective is never resumed')
  assert.equal(w.commands.length,0)
  assert.equal(w.pendingFor(42).length,0,'the expired objective is cleared')
}
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  // Another flow asks the user a newer question.
  w.memories.push({telegram_id:42,content:JSON.stringify({type:'followup_state',kind:'calendar_invite_attendee',payload:{},created_at:new Date().toISOString()}),created_at:'2099-01-01T00:00:00.000Z'})
  assert.equal(await w.send(42,'colleague@example.com'),null,'a bare email answers the newest question, not an older account objective')
  assert.equal(w.commands.length,0)
}
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  assert.equal(await w.send(42,'what is the weather in Bengaluru'),null)
  assert.equal(w.pendingFor(42).length,0,'an unrelated turn invalidates the pending objective')
  assert.equal(await w.send(42,'gogo@example.com'),null,'a later stray email cannot attach to the abandoned objective')
  assert.equal(w.commands.length,0)
}
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  assert.equal(await w.send(77,'intruder@example.com'),null,"another user's email never reaches this user's objective")
  assert.equal(w.pendingFor(42).length,1,"another user's message leaves this objective untouched")
  const own=await w.send(42,'gogo@example.com')
  assert.equal(own.status,'waiting_approval')
  assert.match(w.commands[0].command.objective,/gogo@example\.com/)
  assert.doesNotMatch(w.commands[0].command.objective,/intruder/)
}
{
  const w=makeWorld()
  const ask=await w.send(42,'Create an account on Example Notes using gogo@example.com')
  assert.match(ask.text,/official Example Notes signup-page URL/,'an unregistered provider waits for the user to supply its official link')
  const run=await w.send(42,'https://notes.example.org/signup')
  assert.equal(run.status,'waiting_approval','a URL follow-up resumes the correct objective')
  assert.equal(w.commands[0].command.url,'https://notes.example.org/signup')
  assert.match(w.commands[0].command.objective,/gogo@example\.com/,'the email from the original turn is carried into the run')
}
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  const other=await w.send(42,'Create an account on Instagram using b@example.com')
  assert.match(other.text,/Instagram/,'a new independent objective is handled as its own request')
  assert.doesNotMatch(other.text,/Hugging Face/)
}

// ---------------------------------------------------------------- Codex P2 (b0e8f9ce): email then URL for an unregistered provider
{
  const w=makeWorld()
  const askEmail=await w.send(42,'Create an account on Example Notes')
  assert.match(askEmail.text,/Which email should I use for the Example Notes account\?/)
  const askUrl=await w.send(42,'gogo@example.com')
  assert.match(askUrl.text,/official Example Notes signup-page URL/,'with no email or URL, the email answer moves the objective to the URL stage')
  const run=await w.send(42,'https://notes.example.org/signup')
  assert.equal(run.status,'waiting_approval','the URL binds to the URL question that the email turn produced')
  assert.equal(w.commands.length,1)
  assert.equal(w.commands[0].command.url,'https://notes.example.org/signup')
}

// ---------------------------------------------------------------- Codex P2 (b0e8f9ce): a turn handled before the account router
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  // WhatsApp can answer an unrelated command before the account router runs, so the account
  // flow never sees it; that handler still persists the turn.
  w.conversations.push({telegram_id:42,role:'user',content:'remind me to call mom at 6',created_at:'2099-01-01T00:00:00.000Z'})
  w.conversations.push({telegram_id:42,role:'assistant',content:'Okay, I will remind you at 6 PM.',created_at:'2099-01-01T00:00:01.000Z'})
  assert.equal(await w.send(42,'colleague@example.com'),null,'an email after an intervening handled turn never attaches to the older objective')
  assert.equal(w.commands.length,0)
}
{
  const w=makeWorld()
  // A pending state saved before prompts were recorded cannot prove its binding: re-ask.
  w.memories.push({telegram_id:42,content:JSON.stringify({type:'followup_state',kind:'external_account_create',payload:{service:'Hugging Face',url:null,stage:'email',originText:'Create an account on Hugging Face'},created_at:new Date().toISOString()}),created_at:'2099-01-01T00:00:00.000Z'})
  w.conversations.push({telegram_id:42,role:'user',content:'Create an account on Hugging Face',created_at:'2099-01-01T00:00:00.000Z'})
  assert.equal(await w.send(42,'gogo@example.com'),null,'legacy pending state without a recorded prompt does not bind')
  assert.equal(w.commands.length,0)
}

// ---------------------------------------------------------------- Codex P1 (b0e8f9ce): vague requests never reach a generic planner
for(const text of ['Create an account for me','Can you make me a new account','Make a new account for my mom']){
  const w=makeWorld()
  const r=await w.send(42,text)
  assert.ok(r,`a vague account request is claimed by the objective flow: ${text}`)
  assert.equal(r.handledBy,'external-account-objective')
  assert.equal(r.status,'paused','it asks which site instead of completing anything')
  assert.match(r.text,/Which website or app should I create the account on\?/)
  assert.equal(w.commands.length,0,'nothing executes for a vague request')
}

// ---------------------------------------------------------------- P1: official site / look-alike domains
{
  const look=(host:string)=>(accountLookalike(host)?.key)||null
  function accountLookalike(host:string){
    const w=makeWorld()
    return w.flow.lookalikeProviderForHost(host)
  }
  for(const host of ['hugginface.co','hugging-face.co','huggingface.co.example.net','huggingface-login.com','instagrarn.com','faceb00k.com','linkedln.com']){
    assert.ok(look(host),`${host} must be recognised as imitating a known provider`)
  }
  for(const host of ['huggingface.co','www.huggingface.co','hub.huggingface.co','example.com','notes.example.org','amazon.com','aws.amazon.com','boxing.com']){
    assert.equal(look(host),null,`${host} must not be flagged as a look-alike`)
  }
  const w=makeWorld()
  await w.send(42,'Create an account on hugginface.co using gogo@example.com')
  const refused=await w.send(42,'https://hugginface.co/join')
  assert.equal(w.commands.length,0,'a look-alike signup link never receives the user details')
  assert.match(refused.text,/imitates Hugging Face/)
  assert.match(refused.text,/huggingface\.co/,'the official domain is named so the user can correct it')
  const corrected=await w.send(42,'https://huggingface.co/join')
  assert.equal(corrected?.status,'waiting_approval','after a refused look-alike, the corrected official link binds and continues')
  assert.equal(w.commands.length,1)
  assert.equal(w.commands[0].command.url,'https://huggingface.co/join')

  const w2=makeWorld()
  const mismatch=await w2.send(42,'Create an account on Hugging Face using gogo@example.com https://huggingface-login.com/join')
  assert.equal(w2.commands.length,0,'a named provider with an off-domain link is never used')
  assert.match(mismatch.text,/not on Hugging Face's official site \(huggingface\.co\)/)
}

// ---------------------------------------------------------------- P1: homoglyph (IDN) hosts fail closed
{
  // Cyrillic small a (U+0430) in "huggingface" becomes punycode, which no ASCII look-alike rule sees.
  const idnUrl='https://huggingf\u0430ce.co/join'
  assert.match(new URL(idnUrl).hostname,/^xn--/,'the homoglyph really is punycode on the wire')
  // Unregistered provider, so the flow waits for a URL (a registry provider would not ask).
  const w=makeWorld()
  const ask=await w.send(42,'Create an account on Example Shop using gogo@example.com')
  assert.equal(ask?.status,'paused')
  const refused=await w.send(42,idnUrl)
  assert.equal(w.commands.length,0,'a punycode/homoglyph host never receives the user details or starts a browser run')
  assert.match(refused.text,/cannot verify safely/)
  const corrected=await w.send(42,'https://example-shop.com/join')
  assert.equal(corrected?.status,'waiting_approval','the ASCII link still binds after an IDN refusal')
  assert.equal(w.commands[0]?.command.url,'https://example-shop.com/join')
}

// ---------------------------------------------------------------- P2: unregistered provider approval warns the user
{
  const w=makeWorld()
  const reply=await w.send(42,'Create an account on Example Shop using gogo@example.com https://example-shop.com/join')
  assert.equal(w.commands.length,1,'an unregistered provider reaches the approval gate once (nothing runs before approval)')
  assert.equal(w.commands[0].command.url,'https://example-shop.com/join')
  assert.equal(reply?.status,'waiting_approval')
  assert.match(reply.text,/not a provider I have verified/,'the approval text tells the user to check an unverified address')
  assert.match(reply.text,/APPROVE/)
  const official=await makeWorld().send(42,'Create an account on Hugging Face using gogo@example.com')
  assert.doesNotMatch(official.text,/not a provider I have verified/,'registry providers do not get the unverified warning')
}

// ---------------------------------------------------------------- Failure containment
{
  const w=makeWorld()
  await w.send(42,'Create an account on Hugging Face')
  w.state.browserThrows=true
  const blocked=await w.send(42,'gogo@example.com')
  assert.equal(blocked.status,'blocked','a failing genuine objective reports an honest blocked state')
  assert.equal(blocked.handledBy,'external-account-objective','it stays claimed by the objective flow, never falls to a generic planner')
  assert.match(blocked.text,/Nothing was submitted/)
  assert.doesNotMatch(blocked.text,/sandbox|503|bom1|error|stack/i,'no internal details reach the user')
}
{
  const w=makeWorld()
  w.state.failReads=true
  assert.equal(await w.send(42,'remind me to call mom at 6'),null,'account bookkeeping failure never breaks an unrelated message')
  const fresh=await w.send(42,'Create an account on Hugging Face')
  assert.equal(fresh.status,'paused','a fresh account request still proceeds when the pending read fails')
}

// ---------------------------------------------------------------- Test 6: intent false positives
for(const text of [
  'I need to register for the yoga class, do I need to create an account?',
  'How do I create an account on Instagram?',
  'how to create an account on huggingface',
  'Gogo, can you tell me how to create an account on Netflix',
  'Is an account required to book on IRCTC?',
  'Do I need to make an account for the marathon registration?',
  'Can you register me for the webinar and create an account for it',
  'Open an account with HDFC bank',
  'open a savings account in SBI',
  'Subscribe me to the mailing list',
  'Book an appointment with the dentist and register me',
  'Register me for the conference',
  'Sign up for the yoga class',
  'I need to create an account later.',
  'Create an account on Zerodha tomorrow',
  'Sign me up for the newsletter',
  'Sign me up on the waitlist',
]){
  assert.equal(accountIntent.parseExternalAccountRequest(text),null,`not an external-account objective: ${text}`)
  const c=classifyAgentRequest(text)
  assert.notEqual(c.capability==='browser'&&c.approvalAction==='submit_form'&&/external account/.test(c.why),true,`classifier must not label it an external-account submission: ${text}`)
}
for(const [text,service] of [
  ['Login to huggingface and create a account for me..','huggingface'],
  ['Can you create an account for me on Hugging Face','Hugging Face'],
  ['Sign up for the newsletter and create an account on Substack','Substack'],
  ['create an account at https://huggingface.co/join','huggingface.co'],
  ['Create an account on Udemy for my course','Udemy'],
  ['Make me an account on Instagram','Instagram'],
  ['Can you sign me up on Substack?','Substack'],
] as const){
  assert.equal(accountIntent.parseExternalAccountRequest(text)?.service,service,`service for: ${text}`)
}

// ---------------------------------------------------------------- Test 4: conditional / negated success claims
{
  const post:any={}
  let page:any=null
  runInNewContext(transpile('lib/agent/post-auth-outcome.ts'),{
    exports:post,console,URL,require(name:string){
      if(name==='./browser-handoff')return {readBrowserHandoffState:async()=>page}
      if(name==='./browser-auth-gate')return {detectHumanAuthGate}
      if(name==='./secure-browser-redaction')return {redactBrowserSensitiveText}
      if(name==='@/lib/supabase-admin')return {supabaseAdmin:{from(){throw new Error('outcome inspection must be read-only')}}}
      throw new Error('unexpected post-auth dependency: '+name)
    },
  })
  const metadata={flow:'account_creation',url:'https://huggingface.co/join',handoff:{stateUrl:'https://state.invalid/handoff',sandboxName:'sb-1'}}
  const verdict=async(text:string,url='https://huggingface.co/welcome')=>{page={url,title:'Hugging Face',text,forms:[]};return post.inspectPostAuthOutcome(metadata)}
  for(const text of [
    'If the account is created, you will receive an email.',
    'Once registration is complete you can sign in.',
    'I could create the account.',
    'The account has not been created.',
    'Waiting for email verification.',
    'Please complete the CAPTCHA.',
    'Your account will be created after you verify your email.',
    'Already registered your account? Sign in.',
  ]){
    const r=await verdict(text)
    assert.notEqual(r.status,'completed',`must not establish success: ${text}`)
  }
  for(const text of ['Your account has been created.','Account created successfully!','Welcome! We have successfully created your account.']){
    const r=await verdict(text)
    assert.equal(r.status,'completed',`genuine provider confirmation is still recognised: ${text}`)
  }
  await assert.rejects(()=>verdict('Your account has been created.','https://huggingface.co.example.net/welcome'),/auth_reconciliation_provider_host_mismatch/,'success text on a different host is never accepted')
}

// ---------------------------------------------------------------- Surface consistency (structural)
{
  const route=fs.readFileSync('app/api/agent/run/route.ts','utf8')
  const branch=route.slice(route.indexOf('if (externalAccount) {'),route.indexOf('const contentDraft'))
  assert.match(branch,/from\('conversations'\)\.insert/,'the web/API surface persists the account turn so follow-ups can bind')
  const accountCall=route.indexOf('await tryRunExternalAccountFlow(')
  const contentCall=route.indexOf('await tryRunContentWorkflow(')
  assert.ok(accountCall>0&&contentCall>0&&accountCall<contentCall,'the objective flow is claimed before other agent routes')
  const classifier=fs.readFileSync('lib/agent/classifier.ts','utf8')
  assert.match(classifier,/mentionsExternalAccountCreation/,'the classifier and the objective flow share one intent rule')
}

console.log('✅ Core v1 external-account acceptance (mocked): objective, binding, isolation, look-alikes, containment, intent, outcome verification')
