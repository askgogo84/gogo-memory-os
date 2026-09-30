import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { ContextFact, ContextPack } from '../lib/agent/context-brain'
const require = createRequire(import.meta.url)
const { buildTravelPresenceFacts, renderContextBlock, prioritizeRecallEvidence, buildContextPack } = require('../lib/agent/context-brain')

// Synthetic records: reproduce competition for the FINAL prompt budget, not just
// whether a ticket-to-fact helper happens to emit a flight number somewhere.
const query = 'What flight details do you already have saved for Mira’s New York trip on 27–28 September 2026? Use my saved records and distinguish anything uncertain.'
const rows = [
  { id:'first',type:'flight',flight_no:'ZZ 239',pnr:'TEST42',booking_group:'TEST42',passengers:['Mira Example'],from_city:'Bengaluru',to_city:'Abu Dhabi',depart_at:'2026-09-27T16:45:00Z',arrive_at:'2026-09-27T20:35:00Z',raw:{timeNormalizationVersion:2} },
  { id:'second',type:'flight',flight_no:'ZZ 1',pnr:'TEST42',booking_group:'TEST42',passengers:['Mira Example'],from_city:'Abu Dhabi',to_city:'New York',depart_at:'2026-09-27T22:35:00Z',arrive_at:'2026-09-28T12:35:00Z',raw:{timeNormalizationVersion:2} },
]
const flights:ContextFact[]=buildTravelPresenceFacts(rows,Date.parse('2026-09-30T10:02:20Z'),60,query)
const noise:ContextFact[]=Array.from({length:12},(_,i)=>({id:`summary-${i}`,source:'semantic_memory',summary:'Mira New York trip information from a saved summary. '.repeat(8),score:0.99,confidence:0.9}))
const pack:ContextPack={query,generatedAt:'2026-09-30T10:02:20Z',memoryEnabled:true,facts:[...noise,...flights],provenance:{lifeEvents:0,travelTickets:2,openLoops:0,semanticMemories:12,insights:0,typedContext:0}}
const block=renderContextBlock(pack,3200)
assert.match(block,/ZZ 239/,'first connecting leg must survive final prompt budget')
assert.match(block,/ZZ 1\b/,'destination leg must survive final prompt budget')
assert.match(block,/Booking ref TEST42/,'booking reference must survive final prompt budget')
assert.match(block,/not verified live arrival/,'schedule must not become evidence of actual landing')
assert.ok(block.indexOf('ZZ 239') < block.indexOf('semantic_memory') || !block.includes('semantic_memory'))
assert.deepEqual(pack.facts.slice(0,12),noise,'rendering must not reorder shared facts in place')
assert.deepEqual(prioritizeRecallEvidence('What flights do I have tomorrow?',pack.facts),pack.facts,'present/future requests retain existing relevance order')
const irrelevant:ContextFact={id:'unrelated',source:'travel_ticket',summary:'Flight Oslo to Bergen',score:1,confidence:1}
assert.notEqual(prioritizeRecallEvidence(query,[irrelevant,...flights])[0].id,'unrelated','an unrelated recorded ticket must not displace matching evidence')

// Exercise the real pack builder with a bounded fake data source. No credentials,
// external model calls, or production mutations are needed to test maxFacts.
const {supabaseAdmin}=require('../lib/supabase-admin')
const originalFrom=supabaseAdmin.from
const originalNow=Date.now
try {
  Date.now=()=>Date.parse('2026-09-30T10:02:20Z')
  supabaseAdmin.from=(table:string)=>{
    let single=false
    const chain:any=new Proxy({}, {get:(_,method)=>{
      if(method==='then')return (resolve:any)=>resolve({data:table==='user_consent_settings'?{memory_enabled:true}:single?null:table==='travel_tickets'?rows:table==='user_insights'?noise.map((f,i)=>({id:i,insight:f.summary,confidence:1})):[],error:null})
      return (...args:any[])=>{if(method==='maybeSingle')single=true;return chain}
    }})
    return chain
  }
  const bounded=await buildContextPack({actor:{userId:'fixture',legacyTelegramId:-123,whatsappId:'',name:'Fixture'},text:query,options:{includeSemantic:false,maxFacts:4}})
  assert.equal(bounded.facts.length,4)
  assert.equal(bounded.facts.filter((f:ContextFact)=>f.source==='travel_ticket').length,2,'both legs survive fact-count truncation')
  const final=renderContextBlock(bounded,3200)
  assert.match(final,/ZZ 239/)
  assert.match(final,/ZZ 1\b/)
  assert.match(final,/Booking ref TEST42/)
} finally {
  supabaseAdmin.from=originalFrom
  Date.now=originalNow
}
console.log('PASS: recorded itinerary survives competing summaries in final prompt budget')
