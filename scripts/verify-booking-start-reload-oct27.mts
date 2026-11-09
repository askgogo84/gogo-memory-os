// 26 Oct live booking 46beb2e2: Google Flights showed its blank form and the run spent its budget re-typing the search.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sc = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const block = sc.slice(sc.indexOf('Google Flights opened its blank search form'), sc.indexOf('One bounded recovery for the actual travel adapter'))
assert.ok(block.includes("if((providerBooking||(params.mode==='read'&&params.recoverFlightSearch===true))&&onGoogle&&!bookingStartReloaded&&wave<3)"), 'bookings and flight reads (27 Oct) on Google only, once, early')
assert.ok(block.includes("/^Where to\\?/i.test(String(c?.label||'').trim())&&!String(c?.value||'').trim()"), 'only when the destination box is empty')
assert.match(block, /actions\.splice\(0,actions\.length,\{kind:'goto',url:String\(params\.url\)\}/, 'reloads exactly the approved URL')
assert.match(sc, /let flightSearchRecoveryUsed=false,bookingStartReloaded=false/)
// Placed after the booking action filter (which drops unobserved gotos), so the reload is not filtered out.
assert.ok(sc.indexOf('Google Flights opened its blank search form') > sc.indexOf("const actions=params.mode==='read'?plan.actions.filter"))
console.log('Booking start reload passed')
{
  // 26 Oct live: the Instamart cart approval named no item or store ("before the final submit/booking/purchase").
  const cmd = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(cmd, /text:'I can do this in the secure browser/)
  assert.match(cmd, /text:`Ready on \$\{site\}: \$\{ask\}/)
  assert.match(cmd, /It never checks out or pays\./)
  assert.match(cmd, /Reply \*APPROVE\* to go ahead or \*REJECT\* to cancel\./)
  const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
  assert.match(route, /browserTask\.status === 'waiting_approval' && !\/\\bAPPROVE\\b\/\.test/)
  console.log('Browser approval wording passed')
}
