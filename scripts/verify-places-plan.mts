// Places in the right area (24 Oct live: Rajajinagar ask returned ITC Windsor and Crescent Road).
import assert from 'node:assert/strict'
import * as P from '../lib/agent/places-search.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }

await check('place asks are recognised with area and count; bookings and orders are not', () => {
  assert.deepEqual(P.placeAsk('Suggest 3 South Indian restaurants in Rajajinagar'), { query: 'South Indian restaurants in Rajajinagar, Bengaluru', area: 'Rajajinagar', count: 3 })
  assert.equal(P.placeAsk('Find a good cafe near Indiranagar')?.area, 'Indiranagar')
  assert.equal(P.placeAsk('best biryani in Koramangala')?.count, 5)
  assert.equal(P.placeAsk('Book a table at Toit for 4'), null)
  assert.equal(P.placeAsk('Order biryani from Meghana'), null)
  assert.equal(P.placeAsk('Suggest restaurants near me'), null)
  assert.equal(P.placeAsk('What is the capital of Karnataka?'), null)
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
