// 26 Oct live (Croma): Gogo filled the delivery pincode but the read-mode guard skipped the dialog's Continue button
// ("fill:done","click:skipped"), so the page never showed delivery for 560086. A plain Continue/Apply inside a
// delivery-location box holding a filled 6-digit pincode now counts as setting the location, not a commit.
// Offline. Run: npx --yes tsx scripts/verify-pincode-continue-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const guard = src.match(/async function isConsequentialControl\(page,selector,onUnavailable,onContext\)\{[\s\S]*?\n\}\n(?=\/\/ 11 Oct live Playo)/)![0]

function box(text: string, inputs: Array<{ value: string; type?: string; name?: string; id?: string; autocomplete?: string; placeholder?: string }>, tagName = 'DIV') {
  return {
    tagName, textContent: text, getAttribute: () => null,
    querySelectorAll: (sel: string) => sel === 'input' ? inputs : [],
    querySelector: (sel: string) => sel.includes('password') ? inputs.find(i => i.type === 'password') || null : null,
  }
}
function button(label: string, container: any, extra: Record<string, any> = {}) {
  return { tagName: 'BUTTON', textContent: label, id: extra.id || '', form: container?.tagName === 'FORM' ? container : null, disabled: false, innerText: label,
    getAttribute: (k: string) => (k in extra ? extra[k] : null),
    closest: (sel: string) => sel === 'form' ? (container?.tagName === 'FORM' ? container : null)
      : (sel.includes('dialog') || sel.includes('form') ? container : null) }
}
async function consequential(el: any, url = 'https://www.croma.com/x/p/1') {
  return await runInNewContext(guard + 'isConsequentialControl(page,"#c")', { page: { url: () => url, locator: () => ({ first: () => ({ evaluate: async (fn: any) => fn(el) }) }) }, location: { href: url } })
}

// The real Croma box (26 Oct 19:20): textContent runs words together and "Pincode" is only the input placeholder.
const realCroma = box('select your locationto check products & delivery options available at your locationgrouporsign in to select addresscontinue',
  [{ value: '560086', getAttribute: (k: string) => (k === 'placeholder' ? 'Enter Pincode' : null) } as any])
assert.equal(await consequential(button('Continue', realCroma, { id: 'apply-pincode-btn' })), false, 'real Croma Continue (run-together text, placeholder-only pincode) is allowed')
const realEmpty = box('select your locationto check products & delivery options available at your locationgrouporsign in to select addresscontinue',
  [{ value: '', getAttribute: (k: string) => (k === 'placeholder' ? 'Enter Pincode' : null) } as any])
assert.equal(await consequential(button('Continue', realEmpty)), true, 'real Croma box with no pincode entered stays blocked')

const LOC = 'SELECT YOUR LOCATION To Check Products & Delivery Options available at your location Get Current Location OR Sign in to select address'
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }]))), false, 'Croma location Continue with a filled pincode is allowed')
assert.equal(await consequential(button('Apply', box('Enter delivery pincode', [{ value: '400049' }]))), false)
// Everything else stays blocked.
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '' }]))), true, 'no pincode entered: still blocked')
assert.equal(await consequential(button('Continue', box('Shipping and payment', [{ value: '560086' }]))), true, 'not a location box')
assert.equal(await consequential(button('Continue', box(LOC + ' Card number CVV', [{ value: '560086' }]))), true, 'payment fields nearby')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }, { value: 'x', type: 'password' }]))), true, 'password field nearby')
assert.equal(await consequential(button('Place order', box(LOC, [{ value: '560086' }]))), true, 'commit labels never exempt')
assert.equal(await consequential(button('Continue to checkout', box(LOC, [{ value: '560086' }]))), true, 'only a bare apply-type label')
assert.equal(await consequential(button('Continue', null)), true, 'no surrounding box: still blocked')
// Execute the deployed P1 examples and adjacent submission boundaries using the actual guard.
for (const attrs of [
  { id: 'checkout-submit', type: 'submit', formaction: '/checkout' },
  { id: 'checkout-submit', type: 'button' },
  { name: 'save_address', type: 'button' },
  { id: 'confirmation', type: 'button' },
  { id: 'check-in', type: 'button' },
  { id: 'checkOut', type: 'button' },
  { name: 'sendApplication', type: 'button' },
  { formaction: '/checkout', type: 'button' },
  { formmethod: 'post', type: 'button' },
  { form: 'external-checkout', type: 'button' },
  { type: 'submit' },
]) {
  assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }]), attrs)), true, 'explicit submission or consequential metadata cannot inherit a location exception')
}
for (const type of ['submit', 'button', undefined]) {
  assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }], 'FORM'), type ? { type } : {})), true, 'native form ownership remains fail closed, including implicit submit')
}
assert.equal(await consequential(button('Continue', box('Delivery address', [{ value: '123456' }]), { type: 'button' })), true, 'generic address content is not a location-only context')
assert.equal(await consequential(button('Continue', box(LOC + ' Checkout', [{ value: '123456' }]), { type: 'button' })), true)
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }, { value: 'someone@example.invalid', type: 'email' }]), { type: 'button' })), true, 'personal data fields are outside the location exception')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', name: 'otp' }]), { type: 'button' })), true, 'an OTP is not a location input')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', name: 'otpCode' }]), { type: 'button' })), true, 'camel-case OTP metadata stays blocked')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }]), { type: 'button', 'aria-label': 'Continue', title: 'Continue', value: 'Continue' })), false, 'equivalent label sources resolve to one location label')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }]), { type: 'button', 'aria-label': 'Continue to checkout' })), true, 'conflicting consequential labels stay blocked')
for (const label of ['Apply', 'Submit', 'Check', 'Done', 'Save', 'Confirm location', 'Update']) {
  assert.equal(await consequential(button(label, box('Enter delivery pincode', [{ value: '123456' }]), { type: 'button' })), false, 'non-form location-only controls retain their intended read behavior')
}
// Location-like controls are checked before legacy research/navigation exemptions.
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }], 'FORM'), { id: 'location-search', type: 'submit' })), true)
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }]), { id: 'search-save-address', type: 'button' })), true)
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }], 'FORM'), { id: 'location-search', type: 'submit', 'aria-label': 'Search' })), true)
for (const name of ['fullName', 'dateOfBirth', 'firstName', 'lastName', 'customerCode', 'oneTimeCode']) {
  assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', name }]), { type: 'button' })), true, 'six digits alone do not turn a personal or unknown field into a pincode')
}
for (const context of ['OTP verification for account login', 'Date of birth', 'Sign in to your account', 'OTPVerification']) {
  assert.equal(await consequential(button('Continue', box(LOC + ' ' + context, [{ value: '123456', name: 'pincode' }]), { type: 'button' })), true, 'explicit personal/authentication context is not setting a delivery location')
}
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', type: 'number', name: 'postalCode', id: 'delivery-pin-field', autocomplete: 'postal-code', placeholder: 'Enter your pincode' }]), { type: 'button' })), false)
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', type: 'tel', name: 'pincode' }]), { type: 'button' })), false, 'phone keyboard with explicit pincode purpose remains a location field')
assert.equal(await consequential(button('Search', box('Search catalogue', [], 'FORM'), { id: 'product-search', type: 'submit' })), false, 'unrelated research controls retain their original behavior')
for (const attrs of [
  { id: 'apply-pincode-btn', type: 'submit' },
  { id: 'apply-pincode-btn', type: 'button', formaction: '/checkout' },
  { id: 'apply-pincode-btn', type: 'button', name: 'submit' },
  { id: 'apply-pincode-btn-checkout', type: 'button' },
]) {
  assert.equal(await consequential(button('Continue', realCroma, attrs)), true, 'the known pincode ID never exempts submission targets or extra commit metadata')
}
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', name: 'fullName' }]), { id: 'apply-pincode-btn', type: 'button' })), true)
assert.equal(await consequential(button('Continue', box(LOC + ' OTP verification', [{ value: '123456' }]), { id: 'apply-pincode-btn', type: 'button' })), true)
const flightLocation = button('Continue', box(LOC, [{ value: '123456' }]), { type: 'button', 'aria-label': '1 passengers' })
const flightClosest = flightLocation.closest
flightLocation.closest = (selector: string) => selector === '[role="search"]' ? {} : selector === '[role="dialog"]' ? null : flightClosest(selector)
assert.equal(await consequential(flightLocation, 'https://www.google.com/travel/flights'), true, 'a passenger-shaped accessible label cannot bypass conflicting location controls')
const flightPassenger = { ...flightLocation, textContent: '1 passengers', innerText: '1 passengers' }
assert.equal(await consequential(flightPassenger, 'https://www.google.com/travel/flights'), false, 'the bounded passenger filter remains a read control')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456' }]), { type: 'button', id: 'add-to-cart' })), true)
console.log('Store location Continue after Gogo enters the pincode is allowed in read mode; every commit stays blocked')
