// Diagnostic ONLY: execute unchanged reservation-lookup sources with an injected inert fetch.
// No network, browser, provider credentials, real tables, customer accounts or booking effects.
// The negative assertions intentionally fail until actual source egress controls are reviewed.
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'

const rg = await import('../lib/agent/reservego.ts')
const booking = await import('../lib/agent/booking-engine.ts')
const outlet = '63c18b9791da76efde2d82ec'
const widget = `https://widget.reservego.co/reserveOutlets/${outlet}?source=fixture`
const venue = 'https://toit.in/bangalore-reservation/'
const listing = 'https://www.zomato.com/bangalore/fixture-table-venue/book'
type Call = {url:string; redirect:string}
let calls:Call[] = []
const inertFetch = (async (url:URL | Request | string, init:RequestInit = {}) => {
  const u = String(url)
  calls.push({url:u,redirect:String(init.redirect || 'follow(default)')})
  if(u === venue) return new Response(`<a href="${widget}">Book a table</a>`,{status:200,headers:{'content-type':'text/html'}})
  if(u === listing) return new Response('<h1>Fixture</h1><p>Flat 20% off</p>',{status:200,headers:{'content-type':'text/html'}})
  // Deliberately make an unsafe request observable without contacting that address.
  return new Response('<h1>inert fixture</h1>',{status:200,headers:{'content-type':'text/html'}})
}) as typeof fetch

let controls=0,safetyPassed=0
const failures:string[]=[]
async function control(label:string,work:()=>Promise<void>){
  try { await work();controls++;console.log('CONTROL PASS '+label) }
  catch(e){failures.push('CONTROL FAILED '+label+': '+String(e));console.error(failures.at(-1))}
}
async function safety(label:string,work:()=>Promise<void>){
  try {await work();safetyPassed++;console.log('SAFETY PASS '+label)}
  catch(e){failures.push('SAFETY RED '+label+': '+String(e));console.error(failures.at(-1))}
}

await control('exact ReserveGo widget discovery does not fetch provider HTML',async()=>{
  calls=[]
  assert.deepEqual(await rg.findReservegoWidget(widget,inertFetch),{outletId:outlet,widgetUrl:widget})
  assert.equal(calls.length,0)
})
await control('public HTTPS first-party page reveals its correct widget without any booking',async()=>{
  calls=[]
  assert.deepEqual(await rg.findReservegoWidget(venue,inertFetch),{outletId:outlet,widgetUrl:widget})
  assert.deepEqual(calls.map(c=>c.url),[venue])
})
await control('plain HTTP page is denied before outbound provider fetch',async()=>{
  calls=[]
  assert.equal(await rg.findReservegoWidget('http://public-restaurant.example/reserve',inertFetch),null)
  assert.equal(calls.length,0)
})
await control('aggregator collector drops non-catalogue private or attacker URLs',async()=>{
  const options=booking.collectBookingOptions([
    {url:listing,title:'Fixture venue'},
    {url:'https://127.0.0.1/internal',title:'Internal metadata'},
    {url:'https://attacker.example/redirect',title:'Spoofed table'},
  ],[])
  assert.deepEqual(options.map(o=>o.platform.id),['zomato'])
})
await control('public catalogue listing can be enriched through inert response',async()=>{
  calls=[]
  const options=booking.collectBookingOptions([{url:listing,title:'Fixture venue',snippet:''}],[])
  const result=await booking.enrichOffersFromListings(options,inertFetch)
  assert.equal(result.length,1)
  assert.equal(result[0]?.offer?.percent,20)
  assert.deepEqual(calls.map(c=>c.url),[listing])
})

// These safety assertions MUST fail against the original shipped 31 Oct code.
// URLs are only supplied to injected inertFetch; no real network path is exercised.
for(const [name,url] of [
  ['cloud metadata link-local IPv4','https://169.254.169.254/latest/meta-data/'],
  ['IPv4 loopback','https://127.0.0.1/admin'],
  ['IPv6 loopback','https://[::1]/internal'],
  ['localhost hostname','https://localhost/internal'],
] as const){
  await safety('ReserveGo discovery must deny '+name+' before fetch',async()=>{
    calls=[]
    await rg.findReservegoWidget(url,inertFetch)
    assert.equal(calls.length,0,'unsafe discovery URL reached injected fetch: '+url)
  })
}
await safety('first-party ReserveGo discovery must not follow an unvalidated redirect',async()=>{
  calls=[]
  await rg.findReservegoWidget(venue,inertFetch)
  assert.equal(calls.length,1)
  assert.ok(['manual','error'].includes(calls[0].redirect),'redirect policy must be manual/error, not follow/default')
})
await safety('catalogued booking listing must not follow a redirect to a private address',async()=>{
  calls=[]
  const options=booking.collectBookingOptions([{url:listing,title:'Fixture venue',snippet:''}],[])
  await booking.enrichOffersFromListings(options,inertFetch)
  assert.equal(calls.length,1)
  assert.ok(['manual','error'].includes(calls[0].redirect),'redirect policy must be manual/error, not follow/default')
})

console.log(JSON.stringify({controlsPassed:controls,controlsExpected:5,safetyPassed,safetyExpected:6,failures:failures.length}))
assert.equal(controls,5,'positive controls are required; never claim a source-level finding from a broken fixture')
if(failures.length)process.exitCode=1
