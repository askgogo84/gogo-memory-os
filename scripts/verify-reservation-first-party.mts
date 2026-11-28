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
import * as guestNameModule from '../lib/agent/reservation-guest-name'

const NOW=Date.parse('2026-10-19T06:10:00Z') // Mon 19 Oct, 11:40 IST
class Clock extends Date{constructor(...a:any[]){super(...(a.length?a:[NOW]) as [])}static now(){return NOW}}
const actor={legacyTelegramId:123,userId:'fixture-owner',whatsappId:'919800001501',name:'Fixture'}
const REQUEST='Book a table for 2 at Toit Indiranagar tomorrow at 7pm'
const WIDGET='https://widget.reservego.com/toit-indiranagar'
const EAZY={title:'Toit Indiranagar, Bengaluru - Book a Table | EazyDiner',url:'https://www.eazydiner.com/bengaluru/toit-indiranagar-330151/reviews',snippet:'Book a table at Toit, Indiranagar, Bengaluru. Get offers.'}
const RESERVEGO={title:'Toit Indiranagar - Reserve a table | ReserveGo',url:WIDGET,snippet:'Reserve a table at Toit Brewpub, 100 Feet Road, Indiranagar, Bengaluru.'}
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText

function makeDb(seed:Record<string,any[]>={},faults:{competingClaim?:boolean;inventoryError?:boolean}={}){
  const tables:Record<string,any[]>=JSON.parse(JSON.stringify(seed));let ids=0
  const writes:Array<{table:string;op:string;value:any}>=[]
  const get=(r:any,k:string)=>{if(k.includes('->>')){const[a,b]=k.split('->>');const v=r[a]?.[b];return v==null?undefined:String(v)}return r[k]}
  function from(table:string){
    const rows=()=>tables[table]||(tables[table]=[])
    let op='select',payload:any=null,limitN=Infinity,orderKey='',asc=true,ignoreDuplicates=false
    const filters:Array<(r:any)=>boolean>=[]
    const exec=(single:boolean)=>{
      if(table==='life_events'&&op==='select'&&!single&&faults.inventoryError)return{data:null,error:{message:'inert inventory unavailable'}}
      if(op==='upsert'&&table==='life_events'){
        // A competing writer claims the exact unique key between lookup and insert.
        if(faults.competingClaim){
          faults.competingClaim=false
          rows().push({id:'competing-event',...JSON.parse(JSON.stringify(payload)),metadata_json:{...payload.metadata_json,reservationUrl:'https://toit.in/reservations',winner:true}})
        }
        const existing=rows().find(r=>String(r.telegram_id)===String(payload.telegram_id)&&r.dedupe_key===payload.dedupe_key)
        if(existing){
          if(ignoreDuplicates)return{data:single?null:[],error:single?{code:'PGRST116',message:'No rows returned'}:null}
          Object.assign(existing,payload);return{data:single?existing:[existing],error:null}
        }
      }
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
      upsert:(v:any,options?:{ignoreDuplicates?:boolean})=>{op='upsert';payload=v;ignoreDuplicates=options?.ignoreDuplicates===true;writes.push({table,op,value:v});return q},
      maybeSingle:async()=>exec(true),single:async()=>exec(true),
      then:(res:any,rej:any)=>Promise.resolve().then(()=>exec(false)).then(res,rej),
    }
    return q
  }
  return{from,tables,writes}
}

type Browser=(p:any)=>Promise<any>
function loadReservation(opts:{search:(q:string)=>any[];browser:Browser;db?:ReturnType<typeof makeDb>;calendarIncomplete?:boolean;calendarWindows?:any[]}){
  const db=opts.db||makeDb({users:[{id:'fixture-owner',telegram_id:123,whatsapp_id:'919800001501',timezone:'Asia/Kolkata',email:null}]})
  const searches:string[]=[],browserCalls:any[]=[],questions:any[]=[]
  const mod:any={}
  const contextPack=async(p:any)=>{const c={ownerId:'123',incomplete:false,coveredFrom:p.options.reservationCalendarCoverage?.from||new Date(NOW).toISOString(),coveredUntil:p.options.reservationCalendarCoverage?.until||'2026-12-17T10:00:00Z'};return{facts:[],reservationTravel:{...c,facts:[]},reservationCalendar:{...c,connected:true,windows:opts.calendarWindows||[],incomplete:opts.calendarIncomplete===true},reservationPreferences:{ownerId:'123',incomplete:false,rules:[]}}}
  runInNewContext(transpile('lib/agent/restaurant-reservation.ts'),{exports:mod,require:(name:string)=>
    name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/timezone'?timezone:
    name==='./reservation-dining-context'?dining:name==='./approval-binding'?binding:name==='./india-locality'?locality:name==='./provider-booking'?providerBooking:
    name==='./reservation-guest-name'?guestNameModule:name==='@/lib/bot/pending-questions'?{openPendingQuestion:async(q:any)=>{questions.push(q);return `q-${questions.length}`}}:
    name==='@/lib/web-search'?{searchWebResults:async(q:string)=>{searches.push(q);return opts.search(q)}}:
    name==='./secure-computer'?{runSecureBrowser:async(p:any)=>{browserCalls.push(p);return opts.browser(p)}}:
    name==='./context-brain'?{buildContextPack:contextPack}:{},
  Date:Clock,Intl,console,URL,Set,Map,Promise})
  return{mod,db,searches,browserCalls,questions}
}
const lines=(t:string)=>String(t||'').split('\n').filter(l=>l.trim()).length
const searchBoth=(q:string)=>/reservego/i.test(q)?[EAZY,RESERVEGO]:[EAZY]
const widgetPage=(times:string[])=>async()=>({status:'completed',url:WIDGET,title:'Toit Indiranagar | ReserveGo',summary:`Available times on Tue, 20 Oct for 2 guests: ${times.join(', ')}`,pageText:`Toit Brewpub Indiranagar. Open 12:00 PM - 1:00 AM. Select date: Tue, 20 Oct. Guests: 2. Available slots: ${times.join(' ')}. 10:00 PM Sold out.`})

const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.stack||e.message:String(e)))}}

await check('impossible explicit dining dates pause both entry points before queue, research or booking',async()=>{
  const h=loadReservation({search:()=>{throw Error('unexpected search')},browser:async()=>{throw Error('unexpected browser')}})
  for(const date of ['2026-11-31','2026-13-01','2027-02-29','2026-10-00','31 November 2026']){
    const text='Book a table for 2 at Toit Indiranagar on '+date+' at 7pm'
    const parsed=h.mod.parseRestaurantReservationIntent(text)
    assert.equal(parsed.dateClarificationNeeded,true,date)
    assert.equal(parsed.requestedDate,'',date)
    for(const result of [await h.mod.queueRestaurantReservationResearch({actor,text}),await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text})]){
      assert.equal(result.status,'paused')
      assert.match(result.text,/not a valid calendar date/)
    }
  }
  assert.equal(h.searches.length,0)
  assert.equal(h.browserCalls.length,0)
  assert.equal(h.db.writes.length,0)
  for(const [date,expected] of [['2028-02-29','2028-02-29'],['30 November 2026','2026-11-30'],['tomorrow','2026-10-20']]){
    const parsed=h.mod.parseRestaurantReservationIntent('Book a table for 2 at Toit Indiranagar on '+date+' at 7pm')
    assert.equal(parsed.requestedDate,expected)
    assert.notEqual(parsed.dateClarificationNeeded,true)
  }
})

// 28 Nov: real failed WhatsApp request. Public venue fixture only, no private management link.
const CHINS_REQUEST='Book a table for 3 at 8pm today at Chins bar and coffee Lavelle road'
const RESERVEX='https://reservex.explorex.co.in/r/0186b7ac-6775-4e1c-9193-eed9f1137077'
const CHINS_PUBLIC={title:'Chins Bar & Kitchen, Plot Number 25 — Book a Table | ReserveX',url:RESERVEX,snippet:'Chins Bar & Kitchen, Lavelle Road, Bengaluru. Reserve a table.'}
const CHINS_COFFEE={title:'Chins Coffee | Book a Table',url:'https://www.swiggy.com/restaurants/bangalore/lavelle-road/chins-coffee-fixture/dineout',snippet:'Chins Coffee Lavelle Road Bangalore'}
await check('time-first exact incident and lowercase venue retain party, date and time',async()=>{
  const h=loadReservation({search:()=>[],browser:async()=>{throw Error('unexpected browser')}})
  for(const request of [CHINS_REQUEST,CHINS_REQUEST.replace('Chins','chins'),CHINS_REQUEST.replace('8pm','8:00 PM')]){
    const parsed=h.mod.parseRestaurantReservationIntent(request)
    assert.match(parsed.restaurant,/^chins bar and coffee lavelle road$/i)
    assert.equal(parsed.partySize,3)
    assert.equal(parsed.preferredStart,'20:00')
    assert.equal(parsed.preferredEnd,'20:00')
    assert.equal(parsed.requestedDate,'2026-10-19')
    assert.equal(parsed.timeClarificationNeeded,false)
  }
  assert.equal(h.mod.parseRestaurantReservationIntent('Book a table for 3 at 8pm today').restaurant,'')
  // The lowercase later-at parser must not replace an explicitly named venue with a time preference.
  for(const preference of ['the next available slot','the first available slot','the earliest open slot','any available time']){
    const parsed=h.mod.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 at '+preference+' between 7 PM and 9 PM.')
    assert.equal(parsed.restaurant,'Naru Noodle Bar',preference)
    assert.equal(parsed.partySize,2)
    assert.equal(parsed.preferredStart,'19:00')
    assert.equal(parsed.preferredEnd,'21:00')
  }
  assert.equal(h.mod.parseRestaurantReservationIntent('Book a table for 3 at the next available slot between 7 PM and 9 PM.').restaurant,'')
  for(const phrase of ['the next available slot','the first available slot','the earliest open slot','any available time']){
    const parsed=h.mod.parseRestaurantReservationIntent('Book a table for 2 at '+phrase+' at Toit Indiranagar')
    assert.equal(parsed.restaurant,'Toit Indiranagar',phrase)
    assert.equal(parsed.partySize,2)
  }
})
await check('provider-neutral search recovers public ReserveX, rejects adjacent cafe and private management URLs',async()=>{
  const privateFixture='https://reservex.explorex.co.in/manage/00000000-0000-0000-0000-000000000000'
  const h=loadReservation({
    search:q=>/official restaurant reserve a table/.test(q)?[CHINS_COFFEE,{...CHINS_PUBLIC,url:privateFixture},CHINS_PUBLIC]:[],
    browser:async p=>({status:'completed',url:p.url,title:'Chins Bar & Kitchen',summary:'Selected date: 2026-10-19. 3 guests. Available slots: 8:00 PM',pageText:'Selected date: 2026-10-19. 3 guests. Available slots: 8:00 PM'})
  })
  const ranked=h.mod.rankReservationCandidates([CHINS_COFFEE,{...CHINS_PUBLIC,url:privateFixture},CHINS_PUBLIC],'Chins bar and coffee Lavelle road')
  assert.equal(ranked[0].url,RESERVEX)
  assert.equal(ranked[0].kind,'widget')
  assert.equal(ranked.some((v:any)=>v.url===privateFixture),false)
  assert.ok(ranked.find((v:any)=>v.url===CHINS_COFFEE.url).score<=0)
  const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:CHINS_REQUEST})
  assert.equal(h.browserCalls.length,1)
  assert.equal(h.browserCalls[0].url,RESERVEX)
  assert.equal(h.browserCalls[0].mode,'read')
  assert.match(h.browserCalls[0].objective,/3 guests/)
  assert.match(result.text,/8pm tonight is available for 3/)
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
  // A private management capability supplied directly is not a new booking route either.
  const blocked=loadReservation({search:()=>{throw Error('unexpected search')},browser:async()=>{throw Error('unexpected browser')}})
  const refused=await blocked.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:CHINS_REQUEST+' '+privateFixture})
  assert.equal(blocked.browserCalls.length,0)
  assert.equal(blocked.searches.length,0)
  assert.equal(blocked.db.tables.agent_approvals?.length||0,0)
  assert.ok(!refused.text.includes(privateFixture))
  // DNS-equivalent spellings must not bypass the private-capability exclusion.
  for(const url of [privateFixture.replace('co.in/','co.in./'),privateFixture.replace('reservex.','www.reservex.'),privateFixture.replace('co.in/','co.in../')]){
    const privateRanked=h.mod.rankReservationCandidates([{...CHINS_PUBLIC,url},CHINS_PUBLIC],'Chins bar and coffee Lavelle road')
    assert.equal(privateRanked.some((v:any)=>v.url===url),false)
    const isolated=loadReservation({search:()=>{throw Error('unexpected search')},browser:async()=>{throw Error('unexpected browser')}})
    const denied=await isolated.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:CHINS_REQUEST+' '+url})
    assert.equal(isolated.browserCalls.length,0)
    assert.equal(isolated.searches.length,0)
    assert.equal(isolated.db.tables.agent_approvals?.length||0,0)
    assert.ok(!denied.text.includes(url))
  }
})
await check('a ReserveX service range alone is not an available slot',async()=>{
  const h=loadReservation({search:()=>[CHINS_PUBLIC],browser:async p=>({status:'completed',url:p.url,title:'Chins',summary:'Selected date: 2026-10-19',pageText:'3 guests. Dinner 7:01 PM - 10:30 PM'})})
  const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:CHINS_REQUEST})
  assert.doesNotMatch(result.text,/is available/)
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
})
await check('one definite read failure can switch to a distinct public route, never resubmit',async()=>{
  const other={title:'Toit Indiranagar - Reserve a table',url:'https://toit.in/reservations',snippet:'Toit Indiranagar Bengaluru reservations'}
  const h=loadReservation({search:()=>[RESERVEGO,other],browser:async p=>{
    if(p.url===WIDGET)throw Error('browser_objective_unverified')
    return {...await widgetPage(['7:00 PM'])(),url:p.url}
  }})
  const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(h.browserCalls.length,2)
  assert.equal(h.browserCalls[1].url,other.url)
  assert.equal(h.browserCalls[1].publicOnly,true)
  assert.ok(h.browserCalls.every(p=>p.mode==='read'))
  assert.equal(h.browserCalls[0].readDeadline,h.browserCalls[1].readDeadline)
  assert.match(result.text,/7pm tomorrow is available/)
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
})
await check('no public route tries Maps once, then offers phone escalation without booking or calling',async()=>{
  const h=loadReservation({search:()=>[],browser:async p=>{assert.equal(p.mode,'read');assert.equal(p.publicOnly,true);assert.ok(p.googleDiningDiscovery);throw Error('browser_objective_unverified')}})
  const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:CHINS_REQUEST})
  assert.match(result.text,/phone call for your approval/)
  assert.doesNotMatch(result.text,/send me the booking link/i)
  assert.equal(h.browserCalls.length,1)
})

await check('numeric venue with time-first request uses Google Maps observed public partner and stages exact approval',async()=>{
  const venue='1522 The Pub Malleshwara'
  const request='Book a table for 2 at 9pm tomorrow at '+venue
  const partner='https://www.eazydiner.com/bengaluru/1522-the-pub-malleshwaram-123456'
  const h=loadReservation({search:()=>[],browser:async p=>{
    assert.equal(p.mode,'read')
    if(p.googleDiningDiscovery){
      assert.equal(p.publicOnly,true)
      assert.equal(p.googleDiningDiscovery.restaurant,venue)
      assert.equal(new URL(p.url).searchParams.get('query'),venue+', Bengaluru, India')
      return {status:'completed',url:p.url,actions:[],googleDining:{partners:['EazyDiner','District Dining','Swiggy'],links:[{url:partner,label:'EazyDiner'}],nativeReview:false}}
    }
    assert.equal(p.url,partner)
    return {status:'completed',url:partner,title:venue,pageText:'1522 The Pub Malleshwara. Selected date: 2026-10-20. Party of 2. Available slots: 9:00 PM.',summary:'Available slots: 9:00 PM',actions:[]}
  }})
  const parsed=h.mod.parseRestaurantReservationIntent(request)
  assert.equal(parsed.restaurant,venue)
  assert.equal(parsed.partySize,2)
  assert.equal(parsed.preferredStart,'21:00')
  const read=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:request})
  assert.match(read.text,/9pm tomorrow is available for 2/)
  assert.equal(h.browserCalls.length,2)
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
  const approval=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Fixture Guest'})
  assert.equal(approval.status,'waiting_approval')
  const event=h.db.tables.life_events[0]
  assert.equal(event.metadata_json.reservationUrl,partner)
  assert.equal(event.metadata_json.providerDiscovery,'google_maps_browser')
  assert.equal(event.preferences_json.preferredStart,'21:00')
  assert.equal(h.db.tables.agent_approvals.length,1)
  assert.ok(h.browserCalls.every(p=>p.mode==='read'))
})
await check('native Google chooser with no public partner handoff never claims availability or creates approval',async()=>{
  const h=loadReservation({search:()=>[],browser:async p=>({status:'completed',url:p.url,actions:[],googleDining:{partners:['EazyDiner','District Dining','Swiggy'],links:[],nativeReview:false}})})
  const out=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:'Book a table for 2 tomorrow at 9pm at 1522 The Pub Malleshwara'})
  assert.equal(out.status,'paused')
  assert.match(out.text,/Google Maps shows booking options/)
  assert.match(out.text,/Availability is not confirmed/)
  assert.equal(h.browserCalls.length,1)
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
})
await check('read-only provider failure cannot recommend a second route when prior objective exists at another time',async()=>{
  const seed={users:[{id:actor.userId,telegram_id:actor.legacyTelegramId,timezone:'Asia/Kolkata'}],life_events:[{id:'prior-objective',telegram_id:String(actor.legacyTelegramId),subtype:'restaurant_booking_release',dedupe_key:'old-objective',lifecycle_state:'planned',metadata_json:{restaurant:'Toit Indiranagar',reservationUrl:WIDGET},preferences_json:{partySize:2,requestedDate:'2026-10-20',preferredStart:'19:01',preferredEnd:'19:01'}}]}
  for(const providerFound of [false,true]){
    const db=makeDb(seed)
    const h=loadReservation({db,search:()=>providerFound?[RESERVEGO]:[],browser:async()=>{throw Error('browser_objective_unverified')}})
    const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
    assert.equal(result.status,'paused')
    assert.match(result.text,/reconcil/i)
    assert.doesNotMatch(result.text,/phone call for your approval|book directly here/i)
    assert.equal(db.tables.life_events.length,1)
    assert.equal(db.tables.agent_approvals?.length||0,0)
  }
  const unavailable=loadReservation({db:makeDb({users:seed.users},{inventoryError:true}),search:()=>[],browser:async()=>{throw Error('unexpected browser')}})
  const refused=await unavailable.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.match(refused.text,/couldn't verify the earlier reservation inventory/i)
  assert.doesNotMatch(refused.text,/phone call for your approval/i)
  const other=loadReservation({db:makeDb({...seed,life_events:seed.life_events.map(row=>({...row,telegram_id:'456'}))}),search:()=>[],browser:async()=>{throw Error('unexpected browser')}})
  const allowed=await other.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.match(allowed.text,/phone call for your approval/i)
})

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
  // The name question goes through the pending-question registry, bound to this exact reply text.
  assert.equal(h.questions.length,1)
  assert.equal(h.questions[0].kind,'reservation_live_slot')
  assert.equal(JSON.stringify(h.questions[0].expects),'["guest_name"]')
  assert.equal(h.questions[0].askedText,r.text)
  assert.equal(h.questions[0].telegramId,123)
  assert.equal(pending.metadata_json.asked_text,r.text)
})

await check('stored email is mentioned only when it exists',async()=>{
  const db=makeDb({users:[{id:'fixture-owner',telegram_id:123,timezone:'Asia/Kolkata',email:'divya@example.com'}]})
  const h=loadReservation({db,search:searchBoth,browser:widgetPage(['7:00 PM'])})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.equal(r.text,"7pm tomorrow is available for 2 at Toit Indiranagar. What name should I book under? I'll use your WhatsApp number ending 1501 and divya@example.com.")
})

await check('19 Oct live: an incomplete Calendar read is disclosed in the live-slot approval, not a dead end',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['7:00 PM']),calendarIncomplete:true})
  await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  const r=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Goverdhan'})
  assert.equal(r.status,'waiting_approval',r.text)
  assert.equal(r.approvalRequired,true)
  assert.match(r.text,/under Goverdhan/)
  assert.match(r.text,/couldn't fully check your calendar for that evening/)
  assert.doesNotMatch(r.text,/bounded travel/)
  assert.ok(lines(r.text)<=3,r.text)
})

await check('19 Oct live: a weeks-long calendar block is not a dinner conflict; a real overlap is shown, not a dead end',async()=>{
  const longBlock={startAt:'2026-10-08T06:00:00.000Z',endAt:'2026-11-11T06:15:00.000Z',sourceRefs:[{type:'calendar_event',id:'standup'}]}
  const h=loadReservation({search:searchBoth,browser:widgetPage(['7:00 PM']),calendarWindows:[longBlock]})
  await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  const r=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Goverdhan'})
  assert.equal(r.status,'waiting_approval',r.text)
  assert.doesNotMatch(r.text,/busy|overlaps/,r.text)
  const meeting={startAt:'2026-10-20T13:00:00.000Z',endAt:'2026-10-20T14:00:00.000Z',sourceRefs:[{type:'calendar_event',id:'m'}]}
  const h2=loadReservation({search:searchBoth,browser:widgetPage(['7:00 PM']),calendarWindows:[meeting]})
  await h2.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  const r2=await h2.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Goverdhan'})
  assert.equal(r2.status,'waiting_approval',r2.text)
  assert.match(r2.text,/Your calendar shows you busy 6:30 PM–7:30 PM then — still book it\?/,r2.text)
  assert.doesNotMatch(r2.text,/No new reservation mission/)
  assert.ok(lines(r2.text)<=3,r2.text)
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
  // Time question first, then the name question replaces it in the registry.
  assert.deepEqual(h.questions.map((q:any)=>[q.kind,q.expects[0],q.askedText]),[['reservation_live_slot','time',r.text],['reservation_live_slot','guest_name',picked.text]])
})

await check('slot reply rejects ambiguity and negation, and respects exact 24-hour replies',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['5:30 PM','6:00 PM','6:30 PM','9:00 PM'])})
  await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  const pending=h.db.tables.agent_runs.find((row:any)=>row.type==='restaurant_reservation_slot')
  assert.equal(pending.error,'awaiting_slot_choice')
  // Synthetic offered alternatives containing both AM and PM.
  pending.metadata_json.alternatives=['06:30','18:30','19:00']
  for(const reply of ['6:30','not 6:30pm','6:30pm or 7pm','24:30','18:99']){
    assert.equal(await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:reply}),null,reply)
    assert.equal(pending.error,'awaiting_slot_choice')
    assert.equal(h.db.tables.agent_approvals?.length||0,0)
  }
  const picked=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'18:30'})
  assert.match(picked.text,/6:30pm tomorrow is available/)
  const updated=h.db.tables.agent_runs.find((row:any)=>row.id===pending.id)
  assert.equal(updated.metadata_json.slot_time,'18:30')
  assert.equal(h.db.tables.agent_approvals?.length||0,0)
  assert.equal(h.browserCalls.length,1,'no additional provider interaction')
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

await check('one owner: tryRunRestaurantReservation never reads a bare name; the pending-question resolver is the only entry on every surface',async()=>{
  const h=loadReservation({search:searchBoth,browser:widgetPage(['7:00 PM'])})
  await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:REQUEST})
  assert.equal(await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:'book under divya rao'}),null,'no second, unbound path for the name step')
  assert.equal((h.db.tables.agent_runs||[]).find((x:any)=>x.type==='restaurant_reservation_slot').status,'paused','the step is still waiting for the registry-bound reply')
  // The registry resumer (continueRestaurantReservationGuestReply) still produces the bounded approval.
  const r=await h.mod.continueRestaurantReservationGuestReply({actor,surface:'web',text:'book under divya rao'})
  assert.equal(r?.status,'waiting_approval')
  assert.equal((h.db.tables.life_event_actions||[])[0].payload_json.guestName,'Divya Rao')
  assert.equal(await h.mod.tryRunRestaurantReservation({actor,surface:'web',text:'what is the weather'}),null)
  const webhook=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8'),agentRun=readFileSync('app/api/agent/run/route.ts','utf8'),dash=readFileSync('app/api/dashboard/chat/route.ts','utf8')
  assert.equal(webhook.includes('tryRunWhatsAppReservationGuestReply('),false,'the webhook no longer has a separate name-step hook')
  assert.ok(webhook.indexOf('await tryResolvePendingQuestion({')>webhook.indexOf('if (approvalIntent(text))'),'APPROVE/REJECT keep first refusal')
  assert.ok(webhook.indexOf('await tryResolvePendingQuestion({')<webhook.indexOf('const unsupported=unsupportedCapability(text)'))
  assert.ok(agentRun.indexOf('await tryResolvePendingQuestion(')>0&&agentRun.indexOf('await tryResolvePendingQuestion(')<agentRun.indexOf('await tryRunRestaurantReservation('),'agent API resolves the question before reservation routing')
  assert.ok(dash.indexOf('await tryResolvePendingQuestion(')<dash.indexOf('await queueRestaurantReservationResearch('))
})

// The provider route may change after a lost response, but an earlier mutation
// remains one objective. Use real preparation/resumption with inert transports.
const alternateToit={title:'Toit Indiranagar - Reserve a table',url:'https://toit.in/reservations',snippet:'Toit Indiranagar Bengaluru reservations'}
async function prepareToitRoute(db:ReturnType<typeof makeDb>,alternate:boolean,request=REQUEST){
  const h=loadReservation({db,search:()=>alternate?[RESERVEGO,alternateToit]:[RESERVEGO],browser:async p=>{
    assert.equal(p.mode,'read')
    if(alternate&&p.url===WIDGET)throw Error('browser_objective_unverified')
    return {...await widgetPage(['7:00 PM'])(),url:p.url}
  }})
  const read=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:request})
  if(!/What name should I book under\?/i.test(read.text))return {h,result:read}
  assert.match(read.text,/available/)
  return {h,result:await h.mod.continueRestaurantReservationGuestReply({actor,surface:'whatsapp',text:'Fixture Guest'})}
}
const reservationDb=()=>makeDb({users:[{id:actor.userId,telegram_id:actor.legacyTelegramId,timezone:'Asia/Kolkata'}]})
await check('cross-provider retry after unknown outcome preserves original action and approval, including legacy key',async()=>{
  for(const legacy of [false,true]){
    const db=reservationDb()
    const first=await prepareToitRoute(db,false)
    assert.equal(first.result.status,'waiting_approval')
    const event=db.tables.life_events[0],action=db.tables.life_event_actions[0]
    const run=db.tables.agent_runs.find(r=>r.metadata_json?.plan_type==='restaurant_reservation_release')!
    if(legacy)event.dedupe_key=createHash('sha256').update([actor.legacyTelegramId,'Toit Indiranagar',WIDGET,2,'19:00','19:00','2026-10-20'].join('|').toLowerCase()).digest('hex').slice(0,40)
    run.status='outcome_unknown';run.error='restaurant_reservation_outcome_unknown'
    action.status='blocked';action.payload_json.blockedReason=run.error
    db.tables.agent_approvals[0].status='approved'
    const before=JSON.stringify({event,action,run,approvals:db.tables.agent_approvals})
    const retry=await prepareToitRoute(db,true,REQUEST.replace('Toit Indiranagar','toit indiranagar'))
    assert.equal(retry.result.status,'paused')
    assert.match(retry.result.text,/reconcil/i)
    assert.equal(db.tables.life_events.length,1)
    assert.equal(db.tables.life_event_actions.length,1)
    assert.equal(db.tables.agent_approvals.length,1)
    assert.equal(JSON.stringify({event,action,run,approvals:db.tables.agent_approvals}),before)
    assert.deepEqual(retry.h.browserCalls.map(p=>[p.mode,p.url]),[['read',WIDGET],['read',alternateToit.url]])
  }
})
await check('active or confirmed mission blocks a different provider; another owner is not a duplicate',async()=>{
  for(const state of ['waiting_approval','completed']){
    const db=reservationDb()
    const first=await prepareToitRoute(db,false)
    assert.equal(first.result.status,'waiting_approval')
    const run=db.tables.agent_runs.find(r=>r.metadata_json?.plan_type==='restaurant_reservation_release')!
    run.status=state
    if(state==='completed')db.tables.life_events[0].metadata_json.reservationConfirmed=true
    const retry=await prepareToitRoute(db,true)
    assert.equal(retry.result.status,'paused')
    assert.equal(db.tables.agent_approvals.length,1)
    assert.equal(db.tables.life_event_actions.length,1)
  }
  const db=reservationDb()
  const first=await prepareToitRoute(db,false)
  assert.equal(first.result.status,'waiting_approval')
  for(const table of ['life_events','life_event_actions','agent_approvals','agent_runs'])for(const row of db.tables[table])row.telegram_id='456'
  const other=await prepareToitRoute(db,true)
  assert.equal(other.result.status,'waiting_approval')
  assert.equal(db.tables.agent_approvals.length,2)
  assert.notEqual(db.tables.life_events[0].dedupe_key,undefined)
})
await check('a replacement slot cannot create another objective after earlier unknown result',async()=>{
  const db=reservationDb()
  const first=await prepareToitRoute(db,false)
  assert.equal(first.result.status,'waiting_approval')
  const run=db.tables.agent_runs.find(r=>r.metadata_json?.plan_type==='restaurant_reservation_release')!
  run.status='outcome_unknown';run.error='restaurant_reservation_confirmation_unknown'
  db.tables.life_event_actions[0].status='blocked'
  const h=loadReservation({db,search:()=>[RESERVEGO],browser:widgetPage(['7:01 PM'])})
  const out=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:REQUEST})
  assert.match(out.text,/reconcil/i)
  assert.doesNotMatch(out.text,/Which one should I book/i)
  assert.equal(db.tables.agent_approvals.length,1)
  assert.equal(db.tables.life_events.length,1)
})
await check('new booking objective key is provider-independent, while approval remains provider-bound',async()=>{
  const a=reservationDb(),b=reservationDb()
  const one=await prepareToitRoute(a,false)
  const two=await prepareToitRoute(b,true)
  assert.equal(one.result.status,'waiting_approval')
  assert.equal(two.result.status,'waiting_approval')
  assert.equal(a.tables.life_events[0].dedupe_key,b.tables.life_events[0].dedupe_key)
  // Exact provider approval remains separately bound.
  assert.notEqual(a.tables.agent_approvals[0].action_hash,b.tables.agent_approvals[0].action_hash)
})

await check('concurrent provider claim cannot overwrite winner or stage a second approval',async()=>{
  const db=makeDb({users:[{id:actor.userId,telegram_id:actor.legacyTelegramId,timezone:'Asia/Kolkata'}]},{competingClaim:true})
  const {result}=await prepareToitRoute(db,false)
  assert.equal(result.status,'paused')
  assert.match(result.text,/reconcil/i)
  assert.equal(db.tables.life_events.length,1)
  assert.equal(db.tables.life_events[0].id,'competing-event')
  assert.equal(db.tables.life_events[0].metadata_json.reservationUrl,alternateToit.url)
  assert.equal(db.tables.life_events[0].metadata_json.winner,true)
  assert.equal(db.tables.life_event_actions?.length||0,0)
  assert.equal(db.tables.agent_approvals?.length||0,0)
})
await check('unreadable objective inventory fails closed before mutation authority',async()=>{
  const db=makeDb({users:[{id:actor.userId,telegram_id:actor.legacyTelegramId,timezone:'Asia/Kolkata'}]},{inventoryError:true})
  const {result}=await prepareToitRoute(db,false)
  assert.equal(result.status,'paused')
  assert.equal(db.tables.life_events?.length||0,0)
  assert.equal(db.tables.life_event_actions?.length||0,0)
  assert.equal(db.tables.agent_approvals?.length||0,0)
})

await check('release-time providers (Naru) keep the existing release mission path',async()=>{
  const h=loadReservation({search:()=>[],browser:async()=>({status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'})})
  const r=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:'Book Naru Noodle Bar for 2 on 2026-10-25 at 8:30 PM only.'})
  assert.equal(r.status,'waiting_approval')
  assert.match(r.text,/Reply APPROVE/)
})

const naruBooking='https://bookings.airmenus.in/eatnaru/order'
const naruPolicy='https://www.narunoodlebar.com/menu'
const naruRequest='Book Naru Noodle Bar for 2 on 2026-10-25 at 8:30 PM only.'
const soldOut={status:'completed',url:naruBooking,pageText:'Sold out.'}
const policyText='Book now. Our online bookings open every Monday at 8:oopm. Dinner at 6:30pm and 8:30pm.'

await check('Naru uses the observed venue policy and Bengaluru release time for a travelling owner',async()=>{
  const db=makeDb({users:[{id:actor.userId,telegram_id:123,timezone:'America/New_York'}]})
  const h=loadReservation({db,search:()=>[],browser:async p=>p.url===naruBooking?soldOut:
    {status:'completed',url:naruPolicy+'/',pageText:policyText}})
  const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:naruRequest})
  assert.deepEqual(h.browserCalls.map(p=>[p.mode,p.url]),[['read',naruBooking],['read',naruPolicy]])
  assert.deepEqual(h.searches,[])
  assert.equal(result.status,'waiting_approval')
  const event=h.db.tables.life_events[0]
  assert.equal(event.metadata_json.releaseAt,'2026-10-19T14:30:00.000Z')
  assert.equal(event.metadata_json.releaseEvidenceUrl,naruPolicy+'/')
  assert.equal(h.db.tables.agent_approvals.length,1)
})

for(const [label,inspection] of Object.entries({
  blocked:{status:'blocked',url:naruPolicy,pageText:policyText},
  redirected:{status:'completed',url:'https://example.com/menu',pageText:policyText},
  wrongPage:{status:'completed',url:'https://www.narunoodlebar.com/contact',pageText:policyText},
  seatingHours:{status:'completed',url:naruPolicy,pageText:'Book now. Dinner 6:30pm and 8:30pm.'},
  unavailable:null,
})){
  await check('Naru creates no approval from '+label+' policy evidence',async()=>{
    const h=loadReservation({search:()=>[{url:naruPolicy,title:'Naru',snippet:policyText}],browser:async p=>{
      if(p.url===naruBooking)return soldOut
      if(!inspection)throw Error('fixture unavailable')
      return inspection
    }})
    const result=await h.mod.tryRunRestaurantReservation({actor,surface:'whatsapp',text:naruRequest})
    assert.equal(result.status,'paused')
    assert.match(result.text,/could not verify an exact future booking-release time/)
    assert.equal(h.db.tables.agent_approvals?.length||0,0)
    assert.equal(h.db.tables.life_events?.length||0,0)
  })
}

if(failures.length){console.error(failures.join('\n\n'));process.exitCode=1}else console.log('First-party reservation flow passed: widget ranking, slot replies, name approval, CAPTCHA hand-over, unreadable reply. Inert transports only.')
