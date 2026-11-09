// 26 Oct (owner): Gogo enters the delivery pincode itself on store pages instead of asking the person to type it in
// the remote Take Control view. Offline. Run: npx --yes tsx scripts/verify-delivery-pincode-oct26.mts
// Also runs the web-link vs saved-asset routing checks (registered here to keep package.json free of merge conflicts).
import './verify-asset-url-guard-oct26.mts'
import './verify-pincode-continue-oct26.mts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isStoreHost, requestedPincode, savedPincode, withDeliveryPincode } from '../lib/agent/delivery-pincode'

const CROMA = 'https://www.croma.com/apple-iphone-16-128gb-black-/p/324488'
const ASK = 'Open https://www.croma.com/apple-iphone-16-128gb-black-/p/324488 read-only and hand control back to me so I can set my delivery pincode myself. Do not add to cart or order.'
const env = { COMPARISON_PINCODE: '560086' }

assert.equal(isStoreHost('www.croma.com'), true)
assert.equal(isStoreHost('m.flipkart.com'), true)
assert.equal(isStoreHost('en.wikipedia.org'), false)
assert.equal(isStoreHost('croma.com.evil.test'), false, 'suffix match only on real store domains')

assert.equal(requestedPincode('check price at Croma, pincode 400049'), '400049')
assert.equal(requestedPincode('deliver to 110001 please'), '110001')
assert.equal(requestedPincode('PIN: 560034'), '560034')
assert.equal(requestedPincode('order 123456 status'), null, 'a bare 6-digit number is not a pincode')
assert.equal(requestedPincode('pincode 012345'), null, 'Indian pincodes never start with 0')
assert.equal(savedPincode(env), '560086')
assert.equal(savedPincode({ COMPARISON_PINCODE: 'abc' }), null)
assert.equal(savedPincode({}), null)

// The saved pincode is used on a store page.
const a = withDeliveryPincode(ASK, CROMA, env)
assert.equal(a.pincode, '560086')
assert.match(a.objective, /If the page asks for a delivery pincode or location, enter 560086 and press Continue\/Apply\. This only sets the delivery location \(not a purchase\)/)
assert.ok(a.objective.startsWith(ASK), 'the person\'s own request is kept verbatim first')
// A pincode in the request wins over the saved one.
assert.equal(withDeliveryPincode('Open https://www.croma.com/x/p/1 read-only, pincode 400049', CROMA, env).pincode, '400049')
// Non-store pages and missing pincodes are untouched.
assert.deepEqual(withDeliveryPincode('Open https://en.wikipedia.org/wiki/X', 'https://en.wikipedia.org/wiki/X', env), { objective: 'Open https://en.wikipedia.org/wiki/X', pincode: null })
assert.equal(withDeliveryPincode(ASK, CROMA, {}).objective, ASK)
assert.equal(withDeliveryPincode(ASK, 'not a url', env).objective, ASK)
// Comparison reads already carry their own instruction; no duplicate.
const cmpObj = 'Find the listed price… If asked for a delivery pincode, enter 560086 and press Continue/Apply (not a purchase), then read the price. '
assert.equal(withDeliveryPincode(cmpObj, CROMA, env).objective, cmpObj)

// Wiring: reads only, never executions or Vault logins; the secure browser gets the augmented objective.
const src = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
assert.match(src, /const readObjective=params\.mode==='read'&&!params\.command\.vaultCredentialId&&typeof withDeliveryPincode==='function'\s*\?withDeliveryPincode\(params\.command\.objective,params\.command\.url\)\.objective:params\.command\.objective/)
assert.match(src, /url:params\.command\.url,objective:readObjective,mode:params\.mode/)
console.log('Store reads enter the delivery pincode themselves: requested one first, else the saved one; reads only')
