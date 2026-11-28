import assert from 'node:assert/strict'
import {BUILTIN_SKILLS} from '../lib/agent/skills-builtin'
import {canReviewSkillRevision} from '../lib/agent/governed-learning'
import {classifyMemoryCandidate} from '../lib/agent/governed-memory'
const d=BUILTIN_SKILLS[0].def,next={...d,sopVersion:'1.1.0'}
const scope={kind:'personal' as const,id:'101'}
const p={scope,skillId:d.id,baseVersion:d.sopVersion,nextVersion:next.sopVersion,authorId:'agent-a',evidenceRefs:['receipt:1'],summary:'Improve verification'}
const r={scope,reviewerId:'101',role:'owner' as const,approved:true,testedRevision:d.id+'@'+next.sopVersion,testReceipt:'ci:1',securityReceipt:'security:2',currentVersion:d.sopVersion}
assert.equal(canReviewSkillRevision(p,d,next,r).allowed,true)
assert.equal(canReviewSkillRevision(p,d,next,{...r,reviewerId:'agent-a'}).allowed,false)
assert.equal(canReviewSkillRevision(p,d,next,{...r,scope:{...scope,id:'102'}}).allowed,false)
assert.equal(canReviewSkillRevision(p,d,next,{...r,approved:false}).allowed,false)
assert.equal(canReviewSkillRevision(p,d,next,{...r,securityReceipt:'ci:1'}).allowed,false)
assert.equal(canReviewSkillRevision(p,d,{...next,exactActionApproval:false},r).allowed,false)
assert.equal(canReviewSkillRevision(p,d,{...next,limits:{...next.limits,maxSteps:next.limits.maxSteps+1}},r).allowed,false)
const auth={scopeKind:'personal' as const,scopeId:'101',actorId:'101',mayPublish:true}
const m={scopeKind:'personal' as const,scopeId:'101',actorId:'101',origin:'direct_user' as const,kind:'fact' as const,sourceRef:'turn:1',text:'My preferred hotel is Central',explicitSave:true,expiresAt:null}
assert.equal(classifyMemoryCandidate(m,auth),'candidate')
assert.equal(classifyMemoryCandidate({...m,origin:'email'},auth),'quarantine')
assert.equal(classifyMemoryCandidate({...m,origin:'tool'},auth),'quarantine')
assert.equal(classifyMemoryCandidate({...m,kind:'procedure'},auth),'quarantine')
assert.equal(classifyMemoryCandidate({...m,text:'password is abc12345'},auth),'reject')
assert.equal(classifyMemoryCandidate({...m,expiresAt:0},auth),'reject')
assert.equal(classifyMemoryCandidate({...m,scopeId:'102'},auth),'reject')
assert.equal(classifyMemoryCandidate({...m,explicitSave:false},auth),'quarantine')
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'fixture'
const {runBrainLoop}=await import('../lib/agent/brain-loop')
const actor={userId:'u1',legacyTelegramId:101,name:'Fixture',timezone:'Asia/Kolkata'} as any
const ctx={turns:[],trackedFlights:[],sections:{},name:'Fixture',timezone:'Asia/Kolkata'} as any
let calls=0,toolsRun=0
const use=(name:string,i:number)=>({type:'tool_use',id:'t'+i,name,input:{}})
const tool={name:'fixture_read',klass:'read' as const,description:'Fixture',input_schema:{type:'object' as const,properties:{}},run:async()=>{toolsRun++;return'fixture'}}
const params={actor,ctx,text:'fixture',tools:[tool],mode:'shadow' as const,model:'claude-haiku-5-5',clock:()=>10000}
const fake=(uses:any[])=>({messages:{create:async()=>{calls++;return{content:uses,usage:{input_tokens:1,output_tokens:1}}}}}) as any
assert.equal((await runBrainLoop({...params,client:fake([use('fixture_read',0)]),limits:{maxModelCalls:2}})).stop,'max_steps')
assert.equal(calls,2);assert.equal(toolsRun,2)
calls=0;toolsRun=0
assert.equal((await runBrainLoop({...params,client:fake(Array.from({length:11},(_,i)=>use('fixture_read',i)))})).stop,'max_steps')
assert.equal(calls,1);assert.equal(toolsRun,0)
calls=0;toolsRun=0
await runBrainLoop({...params,client:fake([use('unknown',0),use('unknown',1),use('fixture_read',2)]),limits:{maxToolCalls:2,maxModelCalls:1}})
assert.equal(toolsRun,0)
calls=0
assert.equal((await runBrainLoop({...params,client:fake([use('fixture_read',0)]),limits:{maxModelCalls:1000}})).stop,'error')
assert.equal(calls,0)
console.log('HACHI_GOVERNED_RUNTIME_OK — real Brain Loop caps; non-authoritative learning and memory candidate policies')
