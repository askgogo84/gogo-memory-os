import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isAppointmentResearchRequest, appointmentBookableScore } from '../lib/agent/appointment-research'
import { appointmentPrepareOptionNumber, locationLockedResult } from '../lib/agent/appointment-followup-recovery'

assert.equal(isAppointmentResearchRequest('Find me a dentist appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Look for available dermatologist appointment options near Indiranagar tomorrow'), true)
assert.equal(isAppointmentResearchRequest('Book a dental appointment in Bengaluru next week'), true)
assert.equal(isAppointmentResearchRequest('Create a calendar appointment tomorrow at 4 PM'), false)
assert.equal(isAppointmentResearchRequest('Find cheap flights to Mumbai'), false)

assert.ok(appointmentBookableScore({title:'Book Appointment',snippet:'Choose a slot',url:'https://clinic.example/book-appointment'}) > appointmentBookableScore({title:'Our Clinics',snippet:'Dentist near me',url:'https://clinic.example/our-clinics'}))

const exactFailedProductionFollowup = 'Prepare option 2 and check the available appointment slots for next week. Do not confirm or book anything yet.'
assert.equal(appointmentPrepareOptionNumber(exactFailedProductionFollowup), 2)
assert.equal(appointmentPrepareOptionNumber('Open option #5 and inspect availability'), 5)
assert.equal(appointmentPrepareOptionNumber('Find me a dentist appointment in Bengaluru next week'), null)

// Production regression: once Bengaluru + Clove is selected, a same-provider New Delhi
// URL must never replace it. A city-neutral booking endpoint remains acceptable because
// the browser can still select the locked city without drifting to another branch.
assert.equal(locationLockedResult({url:'https://clovedental.in/dentist-near-me/new-delhi/safdarjung-enclave',title:'Clove Dental Safdarjung Enclave'}, 'Bengaluru'), false)
assert.equal(locationLockedResult({url:'https://clovedental.in/dentist-near-me/bengaluru',title:'Clove Dental Bengaluru'}, 'Bengaluru'), true)
assert.equal(locationLockedResult({url:'https://clovedental.in/appointments',title:'Book Appointment'}, 'Bengaluru'), true)

const agentRoute = fs.readFileSync('app/api/agent/run/route.ts', 'utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts', 'utf8')
const chatRoute = fs.readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const research = fs.readFileSync('lib/agent/appointment-research.ts', 'utf8')
const followup = fs.readFileSync('lib/agent/appointment-followup.ts', 'utf8')
const recovery = fs.readFileSync('lib/agent/appointment-followup-recovery.ts', 'utf8')
const browser = fs.readFileSync('lib/agent/browser-command.ts', 'utf8')
const secureComputer = fs.readFileSync('lib/agent/secure-computer.ts', 'utf8')

assert.match(agentRoute, /tryRunAppointmentResearch/)
assert.match(agentRoute, /tryRunAppointmentFollowup/)
assert.match(agentRoute, /tryRecoverAppointmentOption/)
assert.match(agentRoute, /appointmentPrepareOptionNumber/)
assert.ok(agentRoute.indexOf('appointmentPrepareOptionNumber(text)') < agentRoute.indexOf('tryRunAppointmentResearch({ actor'), 'numbered appointment follow-up must be consumed before any new provider search')
assert.ok(agentRoute.indexOf('tryRunAppointmentFollowup') < agentRoute.indexOf('tryRunBrowserCommand({ actor'), 'appointment follow-up must resume before generic browser routing')
assert.ok(agentRoute.indexOf('tryRunAppointmentResearch({ actor') < agentRoute.indexOf('tryRunPersistentGeneralPlan({'), 'appointment discovery must run before open-ended persistent planning')
assert.match(agentRoute, /I will not start a new search in another location/)

assert.match(chatRoute, /tryRunAppointmentResearch/)
assert.match(chatRoute, /tryRunAppointmentFollowup/)
assert.ok(chatRoute.indexOf('tryRunAppointmentFollowup({ actor') < chatRoute.indexOf('tryRunGeneralPlan({'), 'Talk to Gogo must preserve appointment follow-up before generic planning')

assert.match(research, /readOnly:\s*true/)
assert.match(research, /mutated:\s*false/)
assert.match(research, /I have not claimed a slot is live/)
assert.match(research, /bookableScore/)
assert.match(research, /bookableRanked/)
assert.match(research, /ranked direct booking\/appointment paths ahead of generic clinic pages/i)

assert.match(recovery, /appointment_selection/)
assert.match(recovery, /resolveBookableTarget/)
assert.match(recovery, /site:\$\{originalHost\}/)
assert.match(recovery, /sameProviderHost/)
assert.match(recovery, /locationLockedResult/)
assert.match(recovery, /providerLocked:true,locationLocked:true/)
assert.match(recovery, /Keep the provider AND city locked/)
assert.match(recovery, /retireStaleBookingApprovals/)
assert.match(recovery, /execution_payload/)
assert.match(recovery, /Superseded by a later explicit read-only appointment availability check/)
assert.match(recovery, /hasLiveSlotEvidence/)
assert.match(recovery, /availabilityVerified/)
assert.match(recovery, /could not verify actual live appointment dates\/times/i)
assert.match(recovery, /const objective = `Open [\s\S]*Fill only safe non-sensitive search fields if needed to reveal available dates or times/)
assert.match(recovery, /Navigate within this provider website/)
assert.match(recovery, /Make no provider-side changes/)
assert.match(recovery, /Stop before any final action, login, OTP, CAPTCHA, authentication challenge, or financial step/)
assert.match(recovery, /recoveredContext:\s*true/)
assert.match(recovery, /bookablePathResolved/)
assert.doesNotMatch(recovery, /I only inspected availability and made no provider-side changes/)
assert.doesNotMatch(recovery, /Do not confirm, submit, book, pay, authenticate/)

assert.match(secureComputer, /provider_access_limited/)
assert.match(secureComputer, /your access to this site has been limited/)
assert.match(secureComputer, /const navTimeout = 45000/)
assert.match(browser, /result.status==='blocked'/)
assert.match(browser, /provider_access_limited/)
assert.match(browser, /status:'paused'/)

assert.match(followup, /latestAppointmentResearch/)
assert.match(followup, /appointment_selection/)
assert.match(followup, /Prepare the appointment form flow/)
assert.match(followup, /Stop before final confirmation, submission, authentication or payment/)
assert.match(followup, /agent_approvals/)
assert.match(followup, /action_type:\s*'booking'/)
assert.match(followup, /risk_level:\s*'high'/)
assert.match(followup, /appointment_prepared:\s*true/)
assert.match(followup, /Do not purchase paid add-ons/)
assert.match(followup, /approvalRequired:\s*true/)
assert.match(followup, /need the exact appointment date and time/)
assert.match(followup, /scheduled_at/)
assert.match(followup, /finalizeApprovedAppointmentRun/)
assert.match(followup, /providerConfirmationVerified:\s*true/)
assert.match(followup, /registerLifeEvent/)
assert.match(followup, /eventType:\s*'appointment'/)
assert.match(followup, /appointment_browser_closure/)
assert.match(followup, /I therefore did not create calendar\/reminder\/watch follow-ups/)

assert.match(executeRoute, /finalizeApprovedAppointmentRun/)
assert.ok(executeRoute.indexOf('executeApprovedBrowserCommand') < executeRoute.indexOf('finalizeApprovedAppointmentRun'), 'provider action must execute before appointment closure verification')

console.log('✅ Appointment autonomy regression passed: city-locked provider selection → blocked-site fail-safe → live-slot evidence → exact-slot approval → verified Life Event')

// Real continuation exports with isolated owned DB/browser boundaries. An option
// from another conversation must never stage an old appointment approval.
let lastAssistant:any={content:'Option 1: Nature walk. Option 2: Museum. Option 3: Home baking session.',created_at:new Date().toISOString()}
let browserCalls=0
const ownerFilters:any[]=[]
const researchRow={id:'old-dentist',completed_at:new Date().toISOString(),metadata_json:{location:'Bengaluru',service:'dentist',options:[{index:3,url:'https://clinic.example/appointments',title:'Dentist'}]}}
const fixtureDb={from(table:string){
  const q:any={select(){return q},eq(key:string,value:any){ownerFilters.push([table,key,value]);return q},order(){return q},limit(){return q},in(){return q},gte(){return q},maybeSingle:async()=>({data:table==='conversations'?lastAssistant:researchRow,error:null}),then:(resolve:any)=>Promise.resolve({data:table==='conversations'?[lastAssistant]:[researchRow],error:null}).then(resolve)}
  return q
}}
const exportsFixture:any={}
const dependencies:any={
  '@/lib/supabase-admin':{supabaseAdmin:fixtureDb},
  './typed-object-context':{rememberTypedObjects:async()=>{}},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
  '@/lib/timezone':{DEFAULT_TIMEZONE:'Asia/Kolkata'},
  './calendar-read':{calendarAffirmativeText:(s:string)=>s.split(/\bdo not\b/i)[0]},
  './browser-command':{tryRunBrowserCommand:async()=>{browserCalls++;return {status:'completed',text:'Fixture provider page'}}},
  './life-event-engine':{},
}
runInNewContext(ts.transpileModule(followup,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsFixture,require:(name:string)=>dependencies[name],console,Date,Intl,URL})
const actor={legacyTelegramId:42} as any
const privatePlan='Use option 3 from your last reply. Turn it into a 95-minute plan for the parent and two children, including preparation and cleanup. State any assumptions; do not claim you remember their ages or preferences. Keep this as a private written plan and do not create reminders or contact anyone.'
assert.equal(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:privatePlan}),null,'the actual follow-up must not hijack a private family activity plan')
assert.equal(browserCalls,0)
const recoveryFixture:any={}
runInNewContext(ts.transpileModule(recovery,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recoveryFixture,require:(name:string)=>name==='./appointment-followup'?exportsFixture:dependencies[name],console,Date,Intl,URL})
assert.equal(await recoveryFixture.tryRecoverAppointmentOption({actor,surface:'whatsapp',text:privatePlan}),null,'WhatsApp/API recovery also rejects unrelated option context')
lastAssistant={content:'Appointment options · dentist\n3. Dentist\nBooking/provider page: https://clinic.example/appointments',created_at:new Date().toISOString()}
assert.ok(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 3'}),'genuine current appointment selection still routes')
assert.equal(browserCalls,1)
for(const created_at of ['invalid',new Date(Date.now()-3600_000).toISOString(),new Date(Date.now()+3600_000).toISOString()]){
 lastAssistant={...lastAssistant,created_at}
 assert.equal(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 3'}),null,'stale or invalid conversation must not rebind a numbered choice')
}
assert.ok(ownerFilters.some(([table,key,value])=>table==='conversations'&&key==='telegram_id'&&value===42),'context lookup must remain owner-scoped')
console.log('Actual appointment follow-up and recovery context regression passed')

// A different provider list must not be rebound to an older research row.
lastAssistant={content:'Appointment options · dentist\n3. Other clinic\nBooking/provider page: https://other.example/appointments',created_at:new Date().toISOString()}
assert.equal(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 3'}),null)
const mismatchRecovery=await recoveryFixture.tryRecoverAppointmentOption({actor,surface:'whatsapp',text:'Use option 3'})
assert.equal(mismatchRecovery.status,'paused')
assert.equal(browserCalls,1,'no provider work for a mismatched saved list')

// Execute the actual API POST: its early numbered-choice boundary must also
// decline the unrelated activity request and allow the normal planner to run.
lastAssistant={content:'Option 1: Nature walk. Option 2: Museum. Option 3: Home baking session.',created_at:new Date().toISOString()}
const apiExports:any={}
const noOpModule=new Proxy({}, {get:()=>()=>null})
const apiDependencies:any={
 'node:crypto':{randomUUID:()=> 'fixture-id'},
 'next/server':{NextResponse:{json:(body:any,init:any)=>({body,status:init?.status||200})}},
 '@/lib/supabase-admin':dependencies['@/lib/supabase-admin'],
 '@/lib/agent/session':{requireAgentMutationOrigin:()=>null,requireAgentSession:async()=>({telegramId:42,surface:'web'}),isAgentSession:()=>true},
 '@/lib/agent/actor':{resolveAgentActor:async()=>actor},
 '@/lib/agent/appointment-followup':exportsFixture,
 '@/lib/agent/appointment-followup-recovery':recoveryFixture,
 '@/lib/agent/general-planner':{prepareGeneralPlanForActor:async()=>null,tryRunGeneralPlan:async()=>({text:'Private activity plan',status:'completed',handledBy:'fixture-general-plan'})},
}
runInNewContext(ts.transpileModule(agentRoute,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:apiExports,require:(name:string)=>apiDependencies[name]||noOpModule,console,Date})
const apiReply=await apiExports.POST({json:async()=>({text:privatePlan})})
assert.equal(apiReply.status,200)
assert.equal(apiReply.body.handledBy,'fixture-general-plan','real API must not preempt the private plan as an appointment')
assert.equal(browserCalls,1)
console.log('Actual API POST declined stale appointment context')


lastAssistant={content:'Appointment options · dentist\n3. Dentist\nBooking/provider page: https://clinic.example/appointments',created_at:new Date().toISOString()}
const invalidChoice=await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 9'})
assert.equal(invalidChoice.status,'paused')
lastAssistant={content:invalidChoice.text,created_at:new Date().toISOString()}
assert.ok(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 3'}),'corrected option must keep the displayed appointment list after retry')
console.log('Invalid option correction retains appointment context')

lastAssistant={content:'Appointment options · dentist\n3. Dentist\nBooking/provider page: https://clinic.example/appointments',created_at:new Date().toISOString()}
const invalidRecovery=await recoveryFixture.tryRecoverAppointmentOption({actor,surface:'whatsapp',text:'Use option 9'})
assert.equal(invalidRecovery.status,'paused')
lastAssistant={content:invalidRecovery.text,created_at:new Date().toISOString()}
assert.ok(await exportsFixture.tryRunAppointmentFollowup({actor,surface:'web',text:'Use option 3'}),'recovery retry retains context across surfaces')
