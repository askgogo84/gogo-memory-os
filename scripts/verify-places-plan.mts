// Places in the right area (24 Oct live: Rajajinagar ask returned ITC Windsor and Crescent Road).
import assert from 'node:assert/strict'
import * as P from '../lib/agent/places-search.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }

await check('place asks are recognised with area and count; bookings and orders are not', () => {
  assert.deepEqual(P.placeAsk('Suggest 3 South Indian restaurants in Rajajinagar'), { query: 'South Indian restaurants in Rajajinagar, Bengaluru', area: 'Rajajinagar', count: 3 })
  assert.equal(P.placeAsk('Find a good cafe near Indiranagar')?.area, 'Indiranagar')
  assert.equal(P.placeAsk('Find restaurants near St. Marks Road')?.area, 'St. Marks Road')
  assert.equal(P.placeAsk('Suggest three South Indian restaurants in Rajajinagar')?.query, 'South Indian restaurants in Rajajinagar, Bengaluru')
  assert.equal(P.placeAsk('Suggest three South Indian restaurants in Rajajinagar')?.count, 3)
  assert.deepEqual(P.placeAsk('Find restaurants for 2 people in Mumbai'), {query:'restaurants in Mumbai',area:'Mumbai',count:5})
  assert.deepEqual(P.placeAsk('Find restaurants tomorrow in Mumbai'), {query:'restaurants in Mumbai',area:'Mumbai',count:5})
  assert.equal(P.placeAsk('best biryani in Koramangala')?.count, 5)
  assert.equal(P.placeAsk('Book a table at Toit for 4'), null)
  assert.equal(P.placeAsk('Order biryani from Meghana'), null)
  assert.equal(P.placeAsk('Suggest restaurants near me'), null)
  assert.equal(P.placeAsk('What is the capital of Karnataka?'), null)
})

await check('all supported question leads preserve an explicit venue count', () => {
  for (const lead of ['What are', 'Which are', 'Any', 'Good', 'Nice', 'Where can I find']) {
    assert.equal(P.placeAsk(`${lead} 3 restaurants in Mumbai?`)?.count, 3, `${lead} count`)
    assert.equal(P.placeAsk(`${lead} two cafes in Indiranagar?`)?.count, 2, `${lead} word count`)
  }
})

await check('a negated action never swallows a later affirmative action', async () => {
  const mixed = [
    'Find restaurants in Mumbai; do not book a table, but order food from the first one',
    'Find restaurants in Mumbai; do not reserve anything, but call the first one',
    'Find restaurants in Indiranagar; do not order food but book a table',
    'Find restaurants in Indiranagar; do not book online, call the restaurant and reserve a table',
    'Find restaurants in Mumbai; do not book a table for 2 people but reserve one for 3',
    'Find restaurants in Mumbai; do not book but buy food',
    'Find restaurants in Mumbai; do not reserve but purchase food',
  ]
  let calls = 0
  const forbiddenFetch = (async () => { calls++; throw new Error('unexpected provider call') }) as typeof fetch
  for (const text of mixed) {
    assert.equal(P.placeAsk(text), null, text)
    assert.equal(await P.answerPlaces(text, forbiddenFetch), null, 'mixed action stays out of discovery')
  }
  assert.equal(calls, 0, 'rejected mixed requests never call the places provider')
  assert.ok(P.placeAsk('Find restaurants in Mumbai; do not book a table for 2 people'), 'a purely negated table request remains read-only')
})

await check('25 Oct WhatsApp dining discovery: negated booking, locality comma and party size', async () => {
  const userText = 'Find restaurants in Indiranagar, Bengaluru, for 2 people tomorrow at 8 PM. Show evidence, availability only if provider-verified, and source links. Research only; do not book.'
  assert.deepEqual(P.placeAsk(userText), {
    query: 'restaurants in Indiranagar, Bengaluru', area: 'Indiranagar', count: 5,
  }, 'party size must never be mistaken for number of restaurants')
  assert.equal(P.placeAsk('Find 3 restaurants in Indiranagar, Bengaluru, for 2 people tomorrow')?.count,3)
  assert.equal(P.placeAsk('Find restaurants in Indiranagar, Bengaluru; then book one for me'),null)
  assert.equal(P.placeAsk('Find restaurants in Indiranagar, Bengaluru; reserve one'),null)
  assert.ok(P.placeAsk('Find restaurants in Indiranagar, Bengaluru; do not reserve'))
  process.env.SERPER_API_KEY = 'test'
  let calls=0
  const fixtureFetch=(async (_url:string,opts:any)=>{
    calls++
    const body=JSON.parse(String(opts.body))
    assert.equal(body.q,'restaurants in Indiranagar, Bengaluru')
    return new Response(JSON.stringify({places:[
      {title:'Fixture Indiranagar Restaurant',address:'100 Main Rd, Indiranagar, Bengaluru',rating:4.2,cid:'98765',category:'Restaurant'},
      {title:'Fixture Koramangala Restaurant',address:'80 Main Rd, Koramangala, Bengaluru',rating:4.9,cid:'87654',category:'Restaurant'},
    ]}),{status:200,headers:{'content-type':'application/json'}})
  }) as any
  const reply=await P.answerPlaces(userText,fixtureFetch)
  assert.equal(calls,1)
  assert.match(reply!,/Fixture Indiranagar Restaurant/)
  assert.match(reply!,/https:\/\/maps\.google\.com\/\?cid=98765/)
  assert.match(reply!,/directory listings, not live table availability/i)
  assert.match(reply!,/no booking was made/i)
  assert.doesNotMatch(reply!,/confirmed.*(?:available|booked)|reservation confirmed/i)
})

await check('results inside the asked area come first, with rating and Maps link', async () => {
  process.env.SERPER_API_KEY = 'test'
  const fetchImpl = (async () => new Response(JSON.stringify({ places: [
    { title: 'Dakshin', address: 'ITC Windsor, Golf Course Rd, Bengaluru', rating: 4.6, ratingCount: 3000, cid: '1' },
    { title: 'Shivaji Military Hotel', address: 'Jayanagar, Bengaluru', rating: 4.3, ratingCount: 20000, cid: '2' },
    { title: 'Shree Sagar', address: '18th Cross, Rajajinagar, Bengaluru', rating: 4.4, ratingCount: 8000, cid: '3', category: 'South Indian restaurant' },
    { title: 'Kadamba Veg', address: 'Dr Rajkumar Rd, Rajajinagar, Bengaluru', rating: 4.2, ratingCount: 12000, cid: '4' },
  ] }), { headers: { 'content-type': 'application/json' } })) as any
  const out = await P.answerPlaces('Suggest 3 South Indian restaurants in Rajajinagar', fetchImpl)
  assert.match(out!, /^📍 2 good picks in Rajajinagar/)
  assert.match(out!, /1\. \*Shree Sagar\* · 4\.4★ \(8,000\)/)
  assert.match(out!, /https:\/\/maps\.google\.com\/\?cid=3/)
  assert.doesNotMatch(out!, /Dakshin|Shivaji/)
})

await check('when almost nothing is inside the area it says some picks are nearby', () => {
  const out = P.formatPlaces({ query: 'x', area: 'Malleshwaram', count: 3 }, [{ title: 'A', address: 'Rajajinagar, Bengaluru', rating: 4 }, { title: 'B', address: 'Yeshwanthpur, Bengaluru' }])
  assert.match(out!, /some are nearby/)
})

await check('the asked cuisine comes first: no North Indian dhaba for a South Indian ask', () => {
  const out = P.formatPlaces({ query: 'South Indian restaurants in Rajajinagar, Bengaluru', area: 'Rajajinagar', count: 2 }, [
    { title: 'Chulha Chauki da Dhaba | Rajajinagar', address: 'Dr Rajkumar Rd', rating: 4.7, ratingCount: 7300, category: 'North Indian restaurant' },
    { title: 'Sai Sogadu', address: '14th Cross, below Rajaji Nagar metro', rating: 4.4, ratingCount: 6100, category: 'South Indian restaurant' },
    { title: 'Kakal Kai Ruchi @ Rajajinagar', address: 'Dr Rajkumar Rd', rating: 4.4, ratingCount: 4600, category: 'South Indian restaurant' },
  ])
  assert.doesNotMatch(out!, /Dhaba/); assert.match(out!, /Sai Sogadu/); assert.doesNotMatch(out!, /some are nearby/)
})

const DP: any = await import('../lib/agent/day-plan.ts').catch(() => null)
await check('plan-my-day asks resolve to today or tomorrow; other text does not', () => {
  if (!DP) throw new Error('day-plan failed to load')
  assert.equal(DP.dayPlanRequest('Plan my day tomorrow'), 'tomorrow')
  assert.equal(DP.dayPlanRequest('plan tomorrow'), 'tomorrow')
  assert.equal(DP.dayPlanRequest('Help me plan my day'), 'today')
  assert.equal(DP.dayPlanRequest('plan a trip to Goa'), null)
  assert.equal(DP.dayPlanRequest('What is on my calendar tomorrow?'), null)
})
await check('the plan keeps the real schedule as its input and never runs without one', async () => {
  let seenPrompt = ''
  const plan = await DP.buildDayPlan({ legacyTelegramId: 1 } as any, 'tomorrow', { read: async () => ({ text: 'Calendar tomorrow:\n• Standup — 11:30 am – 11:45 am', timeZone: 'Asia/Kolkata' }), model: async (p: string) => { seenPrompt = p; return '🗓️ Your plan for tomorrow\n11:30–11:45 · Standup' } })
  assert.match(plan, /Standup/); assert.match(seenPrompt, /never invent meetings/); assert.match(seenPrompt, /Standup — 11:30 am/)
  assert.equal(await DP.buildDayPlan({ legacyTelegramId: 1 } as any, 'today', { read: async () => ({ text: '' }), model: async () => 'x' }), null)
})

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('places: all checks passed')
