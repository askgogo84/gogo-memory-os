// 30 Oct live: "show my watches" was four messages of Criteria/Source/Expires/itinerary-owned; a re-forwarded link
// was answered by the brain as "Already saved: gjKPc2zn".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const wc = await import('../lib/agent/watch-command')
const iphone = wc.compactWatchLine({ type: 'web_search', cadence_minutes: 120, condition_json: { title: 'Watch: iPhone 16 128GB on Croma including offers price in India below ₹65,000 including bank/card offers', query: 'iPhone 16 128GB on Croma including offers price in India below ₹65,000 including bank/card offers', priceRule: { threshold: 65000, offers: 'included' } } })
assert.equal(iphone.text, 'iPhone 16 128GB on Croma · below ₹65,000, with offers · every 2 h'); assert.equal(iphone.price, true)
const i17 = wc.compactWatchLine({ type: 'web_search', cadence_minutes: 180, condition_json: { title: 'Watch: iPhone 17 256GB 256GB price in India below 70000 excluding bank/card offers', query: 'iPhone 17 256GB 256GB price in India below 70000 excluding bank/card offers' }, last_state_json: { pendingAlert: { x: 1 } } })
assert.equal(i17.text, 'iPhone 17 256GB · below ₹70,000, listed price · every 3 h · ⚠️ last alert not delivered')
const trip = wc.compactWatchLine({ type: 'web_search', cadence_minutes: 360, condition_json: { contextual: true, title: 'Trip airline news · IndiGo', query: 'IndiGo strike outage cancellations 31 October 2026' } })
assert.equal(trip.text, 'Trip airline news · IndiGo · every 6 h'); assert.equal(trip.price, false)
const src = readFileSync('lib/agent/watch-command.ts', 'utf8')
assert.match(src, /👀 \*Your watches\* \(\$\{ordered\.length\}\)/)
assert.match(src, /Ask \*what are you watching and why\* for reasons and check times/)
const brain = await import('../lib/agent/brain')
assert.equal(brain.isExactCommand('https://lnkd.in/p/gjKPc2zn'), true, 'a bare shared link goes to Link Vault, not the brain')
assert.equal(brain.isExactCommand('what is this https://lnkd.in/p/gjKPc2zn'), false)
console.log('✓ "show my watches" is one short line per watch; a re-forwarded link reaches Link Vault')
assert.match(src, /\(\?:show\|list\|see\|view\)/, 'only a plain "show my watches" is compact; questions keep the detailed answer')
assert.equal(wc.isWatcherStatusQuery('what are you watching and why'), true)
assert.equal(wc.isWatcherStatusQuery('show my watches'), true)
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /m\.isWatcherStatusQuery\(p\.text\)/, 'watch questions are answered from the saved watches, never by the brain')
console.log('✓ watch questions skip the brain')
