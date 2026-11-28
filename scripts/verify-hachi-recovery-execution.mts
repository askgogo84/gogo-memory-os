// Original recovery execution source in a synthetic, closed VM. No provider
// credentials, live database, network, real sends or publication.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {parseRecoveryRequest,exactRecoveryTitle} from '../lib/agent/governed-recovery-profiles'

const source=readFileSync('lib/agent/governed-recovery-execution.ts','utf8')
const ast=ts.createSourceFile('recovery.ts',source,ts.ScriptTarget.Latest,true)
const raw=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n')
const js=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const actor={userId:'owner-101',legacyTelegramId:101,whatsappId:'fixture-only',name:'Fixture'}
function isolate(opts:any={}){
  const e: any={}, state={active:true,allowed:true,generation:1,reads:0,dispatches:0,calendarFetches:0,proofs:[] as any[]}
  let nestedAuthority:()=>Promise<boolean>=async()=>false
  const calendar=[{id:'event-1',summary:'Design Review',start:{dateTime:'2026-11-28T10:00:00Z'},_account:'fixture@example.invalid'}]
  const reminders=[{id:'reminder-1',message:'Rent',remind_at:'2026-11-28T10:00:00Z',timezone:'Asia/Kolkata'}]
  const db={
    from(table:string){
      const fields:Record<string,unknown>={}
      const q:any={
        select(){return q},
        eq(k:string,v:unknown){fields[k]=v;return q},
        neq(){return q},order(){return q},limit(){return q},
        async maybeSingle(){
          assert.equal(table,'users')
          assert.equal(fields.id,actor.userId);assert.equal(fields.telegram_id,101)
          state.reads++
          return {data:{id:actor.userId,telegram_id:101,access_status:'active',google_calendar_connected:true,google_refresh_token:'synthetic',timezone:'Asia/Kolkata'},error:null}
        },
        then(resolve:any,reject:any){
          assert.equal(String(fields.telegram_id),'101')
          state.reads++
          if(table==='reminders')return Promise.resolve({data:opts.reminders||reminders,error:null}).then(resolve,reject)
          if(table==='agent_watchers')return Promise.resolve({count:opts.watchCount??1,error:null}).then(resolve,reject)
          throw Error('Unexpected synthetic table: '+table)
        }
      }
      return q
    }
  }
  const skills=[
    {id:'calendar.exact.read',caps:['calendar'],handler:'calendar-named-read'},
    {id:'reminder.exact.read',caps:['reminders'],handler:'reminder-query'},
    {id:'email.exact.verify',caps:['email'],handler:'gmail-verification'},
    {id:'watcher.exact.status',caps:['browser','reminders'],handler:'watcher-status'}
  ]
  const sandbox={
    exports:e,console,Date,Promise,randomUUID:()=> 'decision-fixture',supabaseAdmin:db,
    exactSessionOwnerId:(v:any)=>String(v)==='101'?'101':null,normalizeTimezone:()=> 'Asia/Kolkata',
    redactSecretShapedText:(s:string)=>s,readableStart:()=> '3:30 pm, Sat 28 Nov',
    getCalendarAccountAccess:async(owner:number,_:string,unavailable:()=>void)=>{assert.equal(owner,101);if(!await nestedAuthority())throw Error('revoked');if(opts.accountIncomplete)unavailable();if(opts.revokeDuringAcquisition)state.active=false;if(opts.republishDuringAcquisition)state.generation++;return [{email:'fixture@example.invalid',accessToken:'synthetic',primary:true}]},
    fetchMergedCalendarEventsPage:async()=>{if(!await nestedAuthority())throw Error('revoked');state.calendarFetches++;state.reads++;if(opts.revokeBetweenPages){state.active=false;if(!await nestedAuthority())throw Error('revoked');state.calendarFetches++}if(opts.revokeDuringRead)state.active=false;return {events:opts.calendar||calendar,hasMore:!!opts.more,accountsRead:1,accountsTotal:1}},
    verifyGmailSentMessage:async(token:string,id:string,thread:string)=>{assert.equal(token,'synthetic');assert.equal(id,'message-1');assert.equal(thread,'thread-1');state.reads++;return {verified:opts.gmailVerified!==false}},
    capabilityPermissionLevel:async(owner:string)=>{assert.equal(owner,'101');return state.allowed?'read':'off'},
    activeRecoveryRevision:async(owner:string,skill:string)=>{assert.equal(owner,'101');return state.active&&!opts.noRevision?{digest:'a'.repeat(64),version:'1.0.1',generation:state.generation,profile:skill}:null},
    governedEnabled:()=>true,governedFenceInstalled:()=>!opts.noFence,currentGovernedRun:()=>null,foregroundInTime:()=>!opts.noScope,
    foregroundRuntime:async(owner:string,open:()=>Promise<any>)=>{assert.equal(owner,'101');return open()},
    openPersonalGovernedRuntime:async()=>({nestedSearch:async(op:string,work:()=>Promise<any>,inTime:()=>boolean,authorize:()=>Promise<boolean>)=>{
      assert.equal(op,'recovery_read');assert.ok(inTime());if(!await authorize())return {state:'blocked',reason:'permission'}
      if(opts.revokeBeforeDispatch)state.allowed=false
      nestedAuthority=authorize;state.dispatches++;return {state:'completed',value:await work()}
    }}),
    parseRecoveryRequest,exactRecoveryTitle,RECOVERY_SKILLS:skills,
    gmailAccess:async(a:any)=>{assert.equal(a.userId,actor.userId);return {ok:true,accessToken:'synthetic'}},
    readGmailSendVerification:async(_:any,verify:any)=>{const r=await verify('message-1','thread-1');return {text:r.verified?'Gmail provider readback confirmed.':'Gmail outcome remains unverified.',verification:{verified:r.verified,objectRef:'send-run-1'}}},
    tryGetWatcherStatusFromCommand:async()=>({text:'Your saved watches',verification:{verified:true,objectRef:'watch-1'}}),
    recordDecisionLearning:async(p:any)=>{state.proofs.push(p)}
  }
  runInNewContext(js,sandbox,{filename:'original recovery execution fixture',timeout:1000})
  return {state,run:(text:string,direct=true,a=actor)=>e.tryGovernedRecoveryProfile(a,text,direct)}
}
{
  const f=isolate()
  const r=await f.run('When is my calendar event Design Review?')
  assert.equal(r.status,'completed');assert.equal(r.readOnly,true);assert.equal(r.mutated,false);assert.match(r.text,/3:30 pm/)
  assert.equal(f.state.proofs[0].readEvidence.objectRef,'event-1')
}
for(const opts of [{more:true},{accountIncomplete:true},{calendar:[{id:'e1',summary:'Design Review'},{id:'e2',summary:'Design Review'}]}]){
  const f=isolate(opts),r=await f.run('When is my calendar event Design Review?')
  assert.equal(r.status,'paused');assert.equal(f.state.proofs[0]?.verified,false)
}
{
  const f=isolate(),r=await f.run('What time is my rent reminder?')
  assert.equal(r.status,'completed');assert.equal(f.state.proofs[0].readEvidence.source,'canonical_reminders')
  assert.equal(await f.run('Move the rent reminder to 4 pm'),null)
  assert.equal(await f.run('When is my rent reminder?',false),null)
  assert.equal(await f.run('When is my rent reminder?',true,{...actor,legacyTelegramId:202}),null)
}
{
  const f=isolate({gmailVerified:false}),r=await f.run('Verify my last Gmail send')
  assert.equal(r.status,'paused');assert.match(r.text,/unverified/);assert.equal(f.state.proofs[0].verified,false)
}
{
  const f=isolate(),r=await f.run('Verify my last Gmail send')
  assert.equal(r.status,'completed');assert.equal(f.state.proofs[0].readEvidence.source,'gmail')
}
{
  const f=isolate({watchCount:13}),r=await f.run('Show my watches')
  assert.equal(r.status,'paused');assert.match(r.text,/partial list/);assert.equal(f.state.proofs[0].verified,false)
}
for(const opts of [{noRevision:true},{noFence:true},{noScope:true},{revokeBeforeDispatch:true}]){
  const f=isolate(opts);await f.run('When is my rent reminder?')
  assert.equal(f.state.reads,0);assert.equal(f.state.proofs.length,0)
}
{
  const f=isolate({revokeDuringRead:true}),r=await f.run('When is my calendar event Design Review?')
  assert.equal(r.status,'paused');assert.doesNotMatch(r.text,/Design Review:|3:30 pm/);assert.equal(f.state.proofs.length,0)
}
for(const opts of [{revokeDuringAcquisition:true},{republishDuringAcquisition:true},{revokeBetweenPages:true}]){
  const f=isolate(opts),r=await f.run('When is my calendar event Design Review?')
  assert.equal(r.status,'paused');assert.equal(f.state.proofs.length,0)
  assert.equal(f.state.calendarFetches,opts.revokeBetweenPages?1:0,'no further page or event dispatch after revocation or rollback/republication')
}
console.log('Original recovery execution: exact read, ambiguity, partial result, owner/surface checks, revoked permission/consent and provider-evidence boundaries passed')
