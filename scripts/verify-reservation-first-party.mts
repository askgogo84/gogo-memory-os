// 19 Oct live (Instinct/Wajo comparison): "Book a table for 2 at Toit Indiranagar tomorrow at 7pm" opened an
// EazyDiner listing, failed read verification (browser_objective_unverified) and replied "I couldn't open its
// booking page". Instinct read Toit's own ReserveGo widget, said "7pm tomorrow is available for two", asked only
// for a name, and on a CAPTCHA handed over the first-party link with nothing booked.
// This harness runs the real restaurant-reservation module and worker with inert transports (no network, no
// sends, no bookings) and checks: first-party ranking, the slot replies, the name -> approval step, the CAPTCHA
// hand-over without retry, and the one-line unreadable reply.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as dining from '../lib/agent/reservation-dining-context'
import * as binding from '../lib/agent/approval-binding'
import * as locality from '../lib/agent/india-locality'
import * as providerBooking from '../lib/agent/provider-booking'

const NOW=Date.parse('2026-10-19T06:10:00Z') // Mon 19 Oct, 11:40 IST
class Clock extends Date{constructor(...a:any[]){super(...(a.length?a:[NOW]) as [])}static now(){return NOW}}
const actor={legacyTelegramId:123,userId:'fixture-owner',whatsappId:'919800001501',name:'Fixture'}
const REQUEST='Book a table for 2 at Toit Indiranagar tomorrow at 7pm'
const WIDGET='https://widget.reservego.com/toit-indiranagar'
const EAZY={title:'Toit Indiranagar, Bengaluru - Book a Table | EazyDiner',url:'https://www.eazydiner.com/bengaluru/toit-indiranagar-330151/reviews',snippet:'Book a table at Toit, Indiranagar, Bengaluru. Get offers.'}
const RESERVEGO={title:'Toit Indiranagar - Reserve a table | ReserveGo',url:WIDGET,snippet:'Reserve a table at Toit Brewpub, 100 Feet Road, Indiranagar, Bengaluru.'}
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText

function makeDb(seed:Record<string,any[]>={}){
  const tables:Record<string,any[]>=JSON.parse(JSON.stringify(seed));let ids=0
  const writes:Array<{table:string;op:string;value:any}>=[]
  const get=(r:any,k:string)=>{if(k.includes('->>')){const[a,b]=k.split('->>');const v=r[a]?.[b];return v==null?undefined:String(v)}return r[k]}
  function from(table:string){
    const rows=()=>tables[table]||(tables[table]=[])
    let op='select',payload:any=null,limitN=Infinity,orderKey='',asc=true
    const filters:Array<(r:any)=>boolean>=[]
    const exec=(single:boolean)=>{
      if(op==='insert'||op==='upsert'){const row={id:`${table}-${++ids}`,...payload};rows().push(row);return{data:single?row:[row],error:null}}
      let matched=rows().filter(r=>filters.every(f=>f(r)))
      if(op==='update'){matched.forEach(r=>Object.assign(r,payload));return{data:single?(matched[0]||null):matched,error:null}}
      if(orderKey)matched=[...matched].sort((x,y)=>String(get(x,orderKey)||'').localeCompare(String(get(y,orderKey)||''))*(asc?1:-1))
      matched=matched.slice(0,limitN)
      return{data:single?(matched[0]||null):matched,error:null}
    }
    const q:any={
      select:()=>q,
      eq:(k:string,v:any)=>{filters.push(r=>String(get(r,k))===String(v));return q},
      in:(k:string,vs:any[])=>{filters.push(r=>vs.map(String).includes(String(get(r,k))));return q},
      is:(k:string,v:any)=>{filters.push(r=>(get(r,k)??null)===v);return q},
      not:()=>q,lte:()=>q,gte:()=>q,lt:()=>q,gt:()=>q,
      order:(k:string,o?:any)=>{orderKey=k;asc=o?.ascending!==false;return q},limit:(n:number)=>{limitN=n;return q},
      update:(v:any)=>{op='update';payload=v;writes.push({table,op,value:v});return q},
      insert:(v:any)=>{op='insert';payload=v;writes.push({table,op,value:v});return q},
      upsert:(v:any)=>{op='upsert';payload=v;writes.push({table,op,value:v});return q},
      maybeSingle:async()=>exec(true),single:async()=>exec(true),
      then:(res:any,rej:any)=>Promise.resolve().then(()=>exec(false)).then(res,rej),
    }
    return q
  }
  return{from,tables,writes}
}

type Browser=(p:any)=>Promise<any>
function loadReservation(opts:{search:(q:string)=>any[];browser:Browser;db?:ReturnType<typeof makeDb>}){
  const db=opts.db||makeDb({users:[{id:'fixture-owner',telegram_id:123,whatsapp_id:'919800001501',timezone:'Asia/Kolkata',email:null}]})
  const searches:string[]=[],browserCalls:any[]=[]
  const mod:any={}
  const contextPack=async(p:any)=>{const c={ownerId:'123',incomplete:false,coveredFrom:p.options.reservationCalendarCoverage?.from||new Date(NOW).toISOString(),coveredUntil:p.options.reservationCalendarCoverage?.until||'2026-12-17T10:00:00Z'};return{facts:[],reservationTravel:{...c,facts:[]},reservationCalendar:{...c,connected:true,windows:[]},reservationPreferences:{ownerId:'123',incomplete:false,rules:[]}}}
  runInNewContext(transpile('lib/agent/restaurant-reservation.ts'),{exports:mod,require:(name:string)=>
    name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/timezone'?timezone:
    name==='./reservation-dining-context'?dining:name==='./approval-binding'?binding:name==='./india-locality'?locality:name==='./provider-booking'?providerBooking:
    name==='@/lib/web-search'?{searchWebResults:async(q:string)=>{searches.push(q);return opts.search(q)}}:
    name==='./secure-computer'?{runSecureBrowser:async(p:any)=>{browserCalls.push(p);return opts.browser(p)}}:
    name==='./context-brain'?{buildContextPack:contextPack}:{},
  Date:Clock,Intl,console,URL,Set,Map,Promise})
  return{mod,db,searches,browserCalls}
}
const lines=(t:string)=>String(t||'').split('\n').filter(l=>l.trim()).length
const searchBoth=(q:string)=>/reservego/i.test(q)?[EAZY,RESERVEGO]:[EAZY]
const widgetPage=(times:string[])=>async()=>({status:'completed',url:WIDGET,title:'Toit Indiranagar | ReserveGo',summary:`Available times on Tue, 20 Oct for 2 guests: ${times.join(', ')}`,pageText:`Toit Brewpub Indiranagar. Open 12:00 PM - 1:00 AM. Select date: Tue, 20 Oct. Guests: 2. Available slots: ${times.join(' ')}. 10:00 PM Sold out.`})

const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.stack||e.message:String(e)))}}

await check('ranking: widget.reservego.com outranks EazyDiner; aggregators only as fallback',async()=>{
  const {mod}=loadReservation({search:searchBoth,browser:async()=>{throw Error('unused')}})
  const ranked=mod.rankReservationCandidates([EAZY,RESERVEGO,{title:'Toit - Reserve',url:'https://toit.in/reservations',snippet:'Toit Indiranagar Bengaluru reservations'}],'Toit Indiranagar')
  assert.equal(ranked[0].url,WIDGET)
  assert.equal(ranked[0].kind,'widget')
  assert.equal(ranked[1].kind,'own_site')
  assert.equal(ranked[ranked.length-1].kind,'aggregator')
  assert.equal(mod.reservationLinkKind('https://book.reservego.com/x','Toit'),'widget')
  assert.equal(mod.reservationLinkKind('https://www.zomato.com/bangalore/toit','Toit'),'aggregator')
  const only=mod.rankReservationCandidates([EAZY],'Toit Indiranagar')
  assert.equal(only[0].kind,'aggregator','an aggregator is still usable when nothing first-party exists')
})

await check('available slot: browser reads the first-party widget; reply asks only for a name in <=3 lines',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['5:30 PM','6:00 PM','6:30 PM','7:00 PM','7:30 PM'])})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(h.browserCalls.length,1)
  assert.equal(h.browserCalls[0].url,WIDGET)
  assert.equal(h.browserCalls[0].mode,'read')
  assert.match(h.browserCalls[0].objective,/2026-10-20/)
  assert.match(h.browserCalls[0].objective,/\b2 guests\b/)
  assert.match(h.browserCalls[0].objective,/Do not enter a name, phone or email/i)
  assert.ok(h.searches[0].match(/reservego/i),'first search targets the first-party widget')
  assert.equal(r.text,"7pm tomorrow is available for 2 at Toit Indiranagar. What name should I book under? I'll use your WhatsApp number ending 1501.")
  assert.ok(lines(r.text)<=3)
  assert.equal(r.status,'paused')
  assert.equal(h.db.writes.some(w=>w.table==='agent_approvals'),false,'no approval before the name')
  const pending=(h.db.tables.agent_runs||[]).find((x:any)=>x.type==='restaurant_reservation_slot')
  assert.ok(pending,'pending name step is durable')
  assert.equal(pending.error,'awaiting_guest_name')
  assert.equal(pending.metadata_json.slot_time,'19:00')
  assert.equal(pending.metadata_json.provider.url,WIDGET)
})

await check('stored email is mentioned only when it exists',async()=>{
  const db=makeDb({users:[{id:'fixture-owner',telegram_id:123,timezone:'Asia/Kolkata',email:'divya@example.com'}]})
  const h=loadReservation({db,search:searchBoth,browser:widgetPage(['7:00 PM'])})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(r.text,"7pm tomorrow is available for 2 at Toit Indiranagar. What name should I book under? I'll use your WhatsApp number ending 1501 and divya@example.com.")
})

await check('name reply goes through the existing approval mechanism; nothing is submitted',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['6:30 PM','7:00 PM'])})
  await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'ok'}),null,'"ok" is not a name')
  assert.equal(await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'thanks gogo'}),null)
  const r=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Divya Rao'})
  assert.ok(r,'name accepted')
  assert.equal(r.status,'waiting_approval')
  assert.equal(r.approvalRequired,true)
  assert.ok(lines(r.text)<=3,r.text)
  assert.equal(r.text,"Ready to book 7pm tomorrow for 2 at Toit Indiranagar under Divya Rao, with your WhatsApp number ending 1501.\nReply APPROVE to book it, or REJECT to stop. I'll stop before any fee, CAPTCHA or OTP.")
  const approval=(h.db.tables.agent_approvals||[])[0]
  assert.ok(approval?.action_hash,'bound approval row')
  const action=(h.db.tables.life_event_actions||[])[0]
  assert.equal(action.payload_json.guestName,'Divya Rao')
  assert.equal(action.payload_json.slotMission,true)
  assert.equal(action.payload_json.reservationUrl,WIDGET)
  assert.equal(action.payload_json.preferredStart,'19:00')
  assert.equal(action.status,'waiting_approval')
  assert.equal(h.browserCalls.length,1,'no second browser run, no submit')
  assert.equal(await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Divya Rao'}),null,'consumed: a repeat does not create a second approval')
  assert.equal((h.db.tables.agent_approvals||[]).length,1)
  const binding=h.mod.restaurantReservationApprovalInput({runId:'r',lifeEventId:'e',actionId:'a',restaurant:'Toit',providerUrl:WIDGET,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:null,guestName:'Divya Rao'})
  assert.equal(binding.payload.guestName,'Divya Rao','guest name is part of the approval hash')
  const legacy=h.mod.restaurantReservationApprovalInput({runId:'r',lifeEventId:'e',actionId:'a',restaurant:'Toit',providerUrl:WIDGET,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:null})
  assert.equal('guestName' in legacy.payload,false,'existing approvals keep their hash')
})

await check('unavailable slot: up to 3 nearest times in one line, then a picked time asks for the name',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['5:30 PM','6:00 PM','6:30 PM','9:00 PM'])})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(r.text,"7pm tomorrow isn't available for 2 at Toit Indiranagar. Open times: 5:30pm, 6pm or 6:30pm. Which one should I book?")
  assert.equal(lines(r.text),1)
  assert.equal(h.db.writes.some(w=>w.table==='agent_approvals'),false)
  assert.equal(await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'8pm'}),null,'a time that was not offered is not accepted')
  const picked=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'6:30pm'})
  assert.equal(picked.text,"6:30pm tomorrow is available for 2 at Toit Indiranagar. What name should I book under? I'll use your WhatsApp number ending 1501.")
})

await check('slot extraction ignores opening hours and sold-out slots; needs the requested date on the page',async()=>{
  const {mod}=loadReservation({search:searchBoth,browser:async()=>({})})
  assert.deepEqual([...mod.extractReservationSlots('Open 12:00 PM - 1:00 AM. Slots: 6:30 PM 7:00 PM 7.30 pm 10:00 PM Sold out 21:15')],['18:30','19:00','19:30','21:15'])
  assert.equal(mod.reservationSlotDateEvidence('Tue, 20 Oct',`2026-10-20`),true)
  assert.equal(mod.reservationSlotDateEvidence('Oct 20',`2026-10-20`),true)
  assert.equal(mod.reservationSlotDateEvidence('Mon, 19 Oct',`2026-10-20`),false)
  const h=loadReservation({search:searchBoth,browser:async()=>({status:'completed',url:WIDGET,summary:'Times: 7:00 PM',pageText:'Mon, 19 Oct. 7:00 PM'})})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.doesNotMatch(r.text,/is available/,'slots for another day are never reported as the requested day')
})

await check('unreadable availability: one line with the first-party link, never an aggregator, no promise',async()=>{
  for(const browser of [async()=>{throw Error('browser_objective_unverified')},async()=>({status:'blocked',url:WIDGET,pageText:'',actions:[]})] as Browser[]){
    const h=loadReservation({search:searchBoth,browser})
    const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
    assert.equal(r.text,`I couldn't read Toit Indiranagar's live tables right now, so nothing is booked. Book directly here: ${WIDGET}`)
    assert.equal(lines(r.text),1)
    assert.doesNotMatch(r.text,/eazydiner|I'll message you/i)
    assert.equal(h.browserCalls.length,1,'no blind retry')
  }
})

await check('CAPTCHA at submission: nothing booked, first-party link, approval spent, no retry',async()=>{
  const sent:string[]=[],browserCalls:any[]=[],cancelled:string[]=[],handoffs:any[]=[]
  const rr=loadReservation({search:searchBoth,browser:async()=>({})}).mod
  const diningContext={version:3,ownerId:'123',from:'2026-10-19T18:30:00.000Z',until:'2026-10-20T18:30:00.000Z',timezone:'Asia/Kolkata',checkedAt:new Date(NOW).toISOString(),incomplete:false,reasons:[],windows:[],calendar:{connected:true,windows:[]},preferences:[]}
  const payload={approvalId:'ap-1',restaurant:'Toit Indiranagar',reservationUrl:WIDGET,reservationLocation:null,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:'2026-10-19T06:00:00.000Z',timeConstraint:{version:1,kind:'exact',start:'19:00',end:'19:00'},contextWindows:[],diningContext,guestName:'Divya Rao',slotMission:true}
  const bound=binding.buildApprovalBinding(rr.restaurantReservationApprovalInput({runId:'run-1',lifeEventId:'ev-1',actionId:'act-1',restaurant:'Toit Indiranagar',providerUrl:WIDGET,partySize:2,preferredStart:'19:00',preferredEnd:'19:00',requestedDate:'2026-10-20',releaseAt:payload.releaseAt,contextWindows:[],diningContext,reservationLocation:null,timeConstraint:payload.timeConstraint,guestName:'Divya Rao'}))
  const db=makeDb({
    life_event_actions:[{id:'act-1',life_event_id:'ev-1',telegram_id:'123',status:'ready',payload_json:payload}],
    life_events:[{id:'ev-1',telegram_id:'123',title:'Reserve Toit Indiranagar',timezone:'Asia/Kolkata',metadata_json:{}}],
    agent_approvals:[{id:'ap-1',run_id:'run-1',telegram_id:'123',action_type:'booking',status:'approved',...bound}],
    agent_runs:[{id:'run-1',telegram_id:'123',status:'queued'}],
    users:[{id:'fixture-owner',telegram_id:123,whatsapp_id:'919800001501',name:'Fixture',timezone:'Asia/Kolkata'}],
  })
  const worker:any={}
  runInNewContext(transpile('lib/agent/restaurant-reservation-worker.ts'),{exports:worker,require:(name:string)=>
    name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/channels/whatsapp'?{sendWhatsAppMessage:async(_to:string,t:string)=>{sent.push(t)}}:
    name==='./secure-computer'?{runSecureBrowser:async(p:any)=>{browserCalls.push(p);return{status:'blocked',blockReason:'human_auth_required',authReason:'captcha',handoffReservation:'hold-1',url:WIDGET+'/details',originalUrl:WIDGET,title:'ReserveGo',summary:'Verify you are human',pageText:'Gogo paused at a human verification check. Nothing was submitted.',forms:[],actions:[]}}}:
    name==='./secondary-auth-handoff'?{attachSecondaryAuthHandoff:async(p:any)=>{handoffs.push(p);return null},releaseRunAuthHandoff:async()=>{}}:
    name==='./provider-browser-handoff'?{cancelBrowserHandoffReservation:async(_u:string,t:string)=>{cancelled.push(t)}}:
    name==='./policy'?{evaluateAgentExecutionPolicy:()=>({allowed:true})}:name==='./sentinel'?{evaluateAgentSentinel:()=>({allowed:true})}:
    name==='./approval-binding'?binding:name==='./restaurant-reservation'?rr:name==='./booking-calendar-execution'?{prepareBookingCalendarApproval:async()=>null}:
    name==='./context-brain'?{buildContextPack:async()=>null}:name==='./reservation-dining-context'?{usableReservationDiningContext:()=>true,buildReservationDiningContext:()=>({}),sameReservationRestrictions:()=>true}:
    name==='./provider-booking'?providerBooking:{},
  Date:Clock,Intl,console,URL,Set,Map,Promise})
  const out=await worker.processOne(db.tables.life_event_actions[0])
  assert.equal(browserCalls.length,1)
  assert.match(browserCalls[0].objective,/guest name "Divya Rao"/)
  assert.equal(sent.length,1)
  assert.equal(sent[0],`Toit Indiranagar's page needs a CAPTCHA, so nothing is booked. This link has 7pm for 2 on 20 Oct ready — finish it there and check the final terms: ${WIDGET}`)
  assert.equal(handoffs.length,0,'no take-over browser loop for a CAPTCHA')
  assert.deepEqual(cancelled,['hold-1'],'held browser is released')
  assert.equal(out.status,'failed')
  assert.equal(db.tables.agent_approvals[0].status,'expired','approval cannot be replayed')
  assert.equal(db.tables.agent_runs[0].status,'failed')
  const again=await worker.processOne(db.tables.life_event_actions[0])
  assert.equal(again.status,'skipped')
  assert.equal(browserCalls.length,1,'no retry')
  assert.equal(rr.reservationChallengeReply({restaurant:'Toit Indiranagar',time:'19:00',date:'2026-10-20',partySize:2,url:WIDGET,kind:'otp'}),`Toit Indiranagar's page needs an OTP, so nothing is booked. This link has 7pm for 2 on 20 Oct ready — finish it there and check the final terms: ${WIDGET}`)
})

await check('dashboard/agent surfaces: tryRunRestaurantReservation continues a pending name step; WhatsApp webhook routes it first',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['7:00 PM'])})
  await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:REQUEST})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:'book under divya rao'})
  assert.equal(r?.status,'waiting_approval')
  assert.equal((h.db.tables.life_event_actions||[])[0].payload_json.guestName,'Divya Rao')
  assert.equal(await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:'what is the weather'}),null)
  const webhook=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8'),bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
  assert.ok(webhook.indexOf('tryRunWhatsAppReservationGuestReply({ user: resolvedUser, text })')>webhook.indexOf('if (approvalIntent(text))'),'APPROVE/REJECT keep first refusal')
  assert.ok(webhook.indexOf('tryRunWhatsAppReservationGuestReply({ user: resolvedUser, text })')<webhook.indexOf('const unsupported=unsupportedCapability(text)'))
  assert.match(bridge,/looksLikeReservationGuestReply\(params\.text\)/)
})

await check('release-time providers (Naru) keep the existing release mission path',async()=>{
  const h=loadReservation({search:()=>[],browser:async()=>({status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'})})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:'Book Naru Noodle Bar for 2 on 2026-10-25 at 8:30 PM only.'})
  assert.equal(r.status,'waiting_approval')
  assert.match(r.text,/Reply APPROVE/)
})

if(failures.length){console.error(failures.join('\n\n'));process.exitCode=1}else console.log('First-party reservation flow passed: widget ranking, slot replies, name approval, CAPTCHA hand-over, unreadable reply. Inert transports only.')
