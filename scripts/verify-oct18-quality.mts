import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://quality-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {parseTravellers}=await import('../lib/agent/flight-booking')
const {tokensEndWords,comparisonEvidenceMatchesSubject,providerObservation,comparisonObjective}=await import('../lib/commerce/comparison-model')
const {productPagePriceEvidence,comparisonReadEvidenceMatches}=await import('../lib/agent/secure-computer')
const {filterBriefingTravelContext}=await import('../lib/services/claude')
const {destinationStayExpiry,declaredHomeCity,desiredWebConditions}=await import('../lib/agent/contextual-travel-watchers')
const {sourceBoundTravelExpiry}=await import('../lib/agent/watchers')
const {formatBrainIntrospection}=await import('../lib/agent/brain-introspection')

assert.equal(parseTravellers('Test Traveller, 1 Jan 1990',new Date('2026-10-18')).travellers[0]?.name,'Test Traveller')
assert.equal(parseTravellers('Traveller: Asha Rao, DOB: 12 Mar 1985',new Date('2026-10-18')).travellers[0]?.name,'Asha Rao')
assert.ok(parseTravellers('Test, 1 Jan 1990').problems.length)
for(const label of ['Apple iPhone 18 Pro 128GB','Apple iPhone 18 Plus 128GB','Apple iPhone 18 Pro Max 128GB'])assert.equal(tokensEndWords(label,['iPhone','18']),false)
assert.equal(tokensEndWords('Apple iPhone 18 Pro 128GB',['iPhone','18','Pro','128GB']),true)
assert.equal(comparisonEvidenceMatchesSubject('Amul butter 500g','Amul Lite butter 500g ₹200'),false)
assert.equal(comparisonEvidenceMatchesSubject('Amul butter 500g','Amul butter 1kg ₹500'),false)
assert.equal(comparisonEvidenceMatchesSubject('Amul butter 500g','Amul butter 0.5kg ₹250'),true)
assert.equal(comparisonEvidenceMatchesSubject('Amul butter 500g','Amul butter 1500g ₹500'),false)
assert.equal(comparisonReadEvidenceMatches('Find the listed price of this product on Zepto: "Amul butter 500g".','Amul butter 1500g ₹500'),false)
assert.equal(comparisonEvidenceMatchesSubject('Logitech M185 wireless mouse, grey, quantity 1,','Logitech M185 wireless mouse grey ₹926'),true,'shopping quantity is not a product variant')
assert.equal(comparisonReadEvidenceMatches('Find the listed price of this product on Flipkart: "Logitech M185 wireless mouse, grey, quantity 1,".','Logitech M185 wireless mouse grey ₹926'),true)
const objective='Find the listed price of this product on Croma: "iPhone 18". This read is only about Croma.'
assert.equal(productPagePriceEvidence(objective,'Buy Apple iPhone 18 Pro 128GB Online - Croma','Apple iPhone 18 Pro 128GB ₹1,20,000'),null)
assert.equal(comparisonReadEvidenceMatches(objective,'Apple iPhone 18 Pro 128GB ₹1,20,000'),false)
assert.equal(comparisonReadEvidenceMatches('Find the listed price of this product on Zepto: "Amul butter 500g".','Amul Lite butter 500g ₹200'),false)
assert.equal(providerObservation('zepto',{id:'fixture',status:'completed'},{status:'completed',output_json:{sourceUrl:'https://www.zepto.com/search?query=butter',summary:'Amul Lite butter 500g ₹200'}},'Amul butter 500g').status,'failed')
const oldPin=process.env.COMPARISON_PINCODE
try{
  process.env.COMPARISON_PINCODE='560086'
  const text=comparisonObjective({metadata_json:{subject:'Amul butter 500g'}} as any,'blinkit')
  assert.match(text,/enter 560086/)
  assert.match(text,/never choose an address silently/)
}finally{if(oldPin===undefined)delete process.env.COMPARISON_PINCODE;else process.env.COMPARISON_PINCODE=oldPin}
const now=new Date('2026-10-18T06:00:00Z')
const filtered=filterBriefingTravelContext("A colleague's KLM flight lands soon on 13 October 2026.\nI move house on 25 October 2026.\nFlight on 20 October 2026.",now)
assert.doesNotMatch(filtered,/13 October/)
assert.match(filtered,/move house/)
assert.match(filtered,/20 October/)
const rows:any=[{id:'00000000-0000-4000-8000-000000000001',telegram_id:123,from_city:'Amsterdam',to_city:'Bengaluru',depart_at:'2026-10-13T08:05:00Z',arrive_at:null}]
const fallback='2026-10-16T08:05:00.000Z'
assert.equal(destinationStayExpiry(rows,fallback),fallback,'one-way weather cannot extend an expired trip by seven days')
const home=declaredHomeCity([{content:'A colleague lives in Bengaluru'},{content:'My home city is Bengaluru'}])
assert.equal(home,'Bengaluru')
assert.ok(!desiredWebConditions(rows,'fixture',fallback,home).some(row=>row.condition.contextClass==='destination_weather'))
const originalFetch=globalThis.fetch
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://quality-fixture.supabase.co');assert.equal(init?.method||'GET','GET')
  assert.equal(url.searchParams.get('telegram_id'),'eq.123')
  return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}})
}
try{
  assert.equal(await sourceBoundTravelExpiry({telegram_id:'123',condition_json:{contextual:true,contextualKind:'travel',expiresAt:'2026-10-20T08:05:00Z',sourceRefs:[{type:'travel_ticket',id:rows[0].id}]}}),fallback)
}finally{globalThis.fetch=originalFetch}
const introspection=formatBrainIntrospection(['calendar','memory'].map((domain,i)=>({telegram_id:'123',event_type:'decision_learning',metadata_json:{schema:'same-brain-v2',domain,handler:'feature-intent',outcome:'unknown',verified:false,decision_id:String(i)}})))
assert.match(introspection,/feature-intent \(calendar\)/)
assert.match(introspection,/feature-intent \(memory\)/)
assert.match(introspection,/at least 20 identified samples/)
console.log('D12–D17 targeted quality: source expiry, home-city weather, stale flight context, exact products, domain labels, traveller names passed; live location/provider acceptance pending')
