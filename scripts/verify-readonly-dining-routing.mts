import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
let dbCalls=0,providerCalls=0
const actual:any={};runInNewContext(ts.transpileModule(readFileSync('lib/agent/restaurant-reservation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:{from(){dbCalls++;throw Error('read-only routing reached DB')}}}:name==='./secure-computer'?{runSecureBrowser(){providerCalls++;throw Error('read-only routing reached provider')}}:{},console,URL,Set,Map})
const actor={legacyTelegramId:123,userId:'fixture-owner'}
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>|void){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.message:String(e)))}finally{dbCalls=0;providerCalls=0}}
async function refuses(text:string){assert.equal(actual.isRestaurantReservationRequest(text),false,text);assert.equal(actual.parseRestaurantReservationIntent(text),null);assert.equal(await actual.tryRunRestaurantReservation({actor,text,surface:'dashboard'}),null);assert.equal(await actual.queueRestaurantReservationResearch({actor,text}),null);assert.equal(dbCalls,0);assert.equal(providerCalls,0)}
await check('live C1 read-only no-book wording bypasses reservation preparation and queue',async()=>{
 await refuses('Based on everything you already know about me, would 25 October around 8:30 PM be a good time for dinner in Bengaluru? Tell me what existing context matters. This is read-only; do not book, send, create reminders or change anything.')
})
await check('read-only dinner and reservation research remain non-authorizing even with booking nouns',async()=>{
 for(const text of ['Review my saved Naru Noodle Bar reservation, read only.','Read-only: book Naru Noodle Bar for 2 on 25 October at 8 PM.','Only check Naru dinner plans; do not book anything.'])await refuses(text)
})
await check('negated booking commands do not become a new reservation from remaining table nouns',async()=>{
 for(const text of ["Review my existing Naru reservation; don't book a new table.",'Tell me whether dinner on 25 October works; do not reserve anything.','Check the Naru reservation without booking another table.','Review Naru dinner; do not create a booking.','Tell me about my Naru table; never make a reservation.'])await refuses(text)
})
await check('coordinated prohibited booking verbs are not separate affirmative authority',async()=>{
 for(const text of ['Check Naru dinner plans; do not book or reserve a table.',"Review my Naru reservation; don't reserve or book anything.",'Check Naru dinner; never book and reserve another table.'])await refuses(text)
})
await check('negative booking objects retain new or additional qualifiers without creating a mission',async()=>{
 for(const text of ['Review my existing Naru Noodle Bar reservation; do not create a new booking.','Review Naru dinner; do not make any new reservation.','Check Naru dinner without placing an additional reservation.'])await refuses(text)
})
await check('affirmative booking with separate zero-fee payment guard retains restaurant workflow',()=>{
 for(const text of ['Book Naru Noodle Bar for 2 between 7 PM and 9 PM. Do not pay any deposit without asking.','Reserve Naru Noodle Bar for 2 on 25 October at 8:30 PM only.','Book Naru Noodle Bar for 2, but do not book if a deposit is required.'])assert.equal(actual.isRestaurantReservationRequest(text),true,text)
})
await check('release monitoring and affirmative future booking remain distinct from read-only planning',()=>{
 assert.equal(actual.isRestaurantReservationRequest('Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM. If bookings are not open yet, monitor the release time and complete the reservation when it opens. Do not exceed any booking fee or deposit without asking me first.'),true)
})
await check('decision recall and reminder-only controls still bypass reservation preparation',async()=>{
 for(const text of ['What did we decide about the Naru dinner reservation?','Remind me tomorrow to book Naru Noodle Bar for 2.'])await refuses(text)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Read-only dining intent preserves actual preparation/queue first refusal; inert transports, not context-answer acceptance.')
