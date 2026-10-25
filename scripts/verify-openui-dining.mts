import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diningObservationFromRun, safeDiningProviderUrl } from '../lib/openui/dining-observation'

const UUID='6d84d990-8888-4d20-9fc7-e331c73a2011'
const NOW=new Date('2026-10-25T10:00:00.000Z')
const slotRun={
  id:UUID,type:'restaurant_reservation_slot',status:'paused',
  updated_at:'2026-10-25T09:57:00.000Z',
  metadata_json:{
    plan_type:'restaurant_reservation_slot',stage:'guest_name',
    restaurant:'Synthetic Toit',party_size:2,requested_date:'2026-10-28',
    preferred_start:'19:00',preferred_end:'21:00',
    provider:{url:'https://widget.reservego.co/toit-indiranagar',title:'Synthetic widget',firstParty:true},
    evidence:'ReserveGo times for 2026-10-28: 19:00, 19:30, 20:00',
    observed_slots:['19:00','19:30','20:00','garbage','19:00'],
    guest_name:'SECRET_NOT_FOR_UI',whatsapp_id:'PRIVATE_PHONE_NOT_FOR_UI',
  },
}
const positive=diningObservationFromRun(slotRun,NOW)
assert(positive)
assert.equal(positive.restaurant,'Synthetic Toit')
assert.equal(positive.partySize,2)
assert.equal(positive.requestedDate,'2026-10-28')
assert.equal(positive.requestedWindow,'19:00–21:00')
assert.deepEqual(positive.observedSlots,['19:00','19:30','20:00'])
assert.equal(positive.status,'historical_slots')
assert.match(positive.note,/not guaranteed|recheck/i)
assert.doesNotMatch(JSON.stringify(positive),/SECRET_NOT_FOR_UI|PRIVATE_PHONE_NOT_FOR_UI/)
assert.equal(positive.sourceUrl,'https://widget.reservego.co/toit-indiranagar')
const old=diningObservationFromRun({...slotRun,updated_at:'2026-10-24T08:00:00Z'},NOW)
assert.match(old?.note||'',/Past slot observation/)
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,evidence:'Open 7 PM to 11 PM'}},NOW)?.observedSlots,[],
  'generic opening hours never become available slots')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,requested_date:'2026-10-29'}},NOW)?.observedSlots,[],
  'slots from a different date must never appear')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,provider:{...slotRun.metadata_json.provider,firstParty:false}}},NOW)?.observedSlots,[],
  'not independently first-party verified')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,provider:{url:'https://evil.test/reserve',firstParty:true}}},NOW)?.observedSlots,[],
  'malicious host is rejected')
assert.equal(diningObservationFromRun({...slotRun,type:'generic_agent'},NOW),null)
assert.equal(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,plan_type:'another_plan'}},NOW),null)

const research=diningObservationFromRun({id:UUID,type:'restaurant_reservation_research',status:'completed',
 updated_at:'2026-10-25T09:00:00Z',metadata_json:{plan_type:'restaurant_reservation_research',
 restaurant:'Synthetic Naru',party_size:2,requested_date:'2026-10-28',preferred_start:'20:30',preferred_end:'20:30',
 observed_slots:['20:30'],provider:{url:'https://widget.reservego.co/reserve',firstParty:true},
 evidence:'ReserveGo times for 2026-10-28: 20:30'}},NOW)
assert.deepEqual(research?.observedSlots,[],'completed background research does not prove a table was available')
assert.equal(research?.status,'needs_review')
for(const url of [
  'https://reservego.co.evil.test/widget',
  'http://widget.reservego.co/widget',
  'https://user:pass@widget.reservego.co/widget',
  'https://localhost/widget',
  'javascript:alert(1)',
])assert.equal(safeDiningProviderUrl(url),null,'unsafe booking source refused: '+url)
assert.equal(safeDiningProviderUrl('https://widget.reservego.co/widget?token=secret'),
  'https://widget.reservego.co/widget','strip account/session tokens from link')

const route=readFileSync('app/api/openui/dining/[id]/route.ts','utf8')
assert.match(route,/requireAgentSession\(request\)/)
assert.match(route,/isAgentSession\(session\)/)
assert.match(route,/\.eq\('id',id\)/)
assert.match(route,/\.eq\('telegram_id',String\(session.telegramId\)\)/)
assert.match(route,/\.in\('type',\['restaurant_reservation_slot','restaurant_reservation_research'\]\)/)
assert.match(route,/private, no-store/)
assert.doesNotMatch(route,/insert\(|update\(|delete\(|\.rpc\(/,'dining view must not mutate database')
const ui=readFileSync('components/dashboard/openui-dining-results.tsx','utf8')
assert.match(ui,/Not a booking or a real-time availability check/)
assert.match(ui,/Selecting a slot prepares a read-only question/)
assert.doesNotMatch(ui,/method:\s*['"]POST['"]|fetch\(|bookTable\(|completeBooking\(|submitBooking\(/)
const page=readFileSync('app/dashboard/(app)/dining-results/[id]/page.tsx','utf8')
assert.match(page,/\/api\/openui\/dining\//)
assert.match(page,/credentials:'same-origin'/)
const activity=readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
assert.match(activity,/\/dashboard\/dining-results\//)
console.log('OPENUI-DINING-03: source, identity, historical-slot and read-only contracts PASS (synthetic)')
