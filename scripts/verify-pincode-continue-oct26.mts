// 26 Oct live (Croma): Gogo filled the delivery pincode but the read-mode guard skipped the dialog's Continue button
// ("fill:done","click:skipped"), so the page never showed delivery for 560086. A plain Continue/Apply inside a
// delivery-location box holding a filled 6-digit pincode now counts as setting the location, not a commit.
// Offline. Run: npx --yes tsx scripts/verify-pincode-continue-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const guard = src.match(/async function isConsequentialControl\(page,selector,onUnavailable,onContext\)\{[\s\S]*?\n\}\n(?=\/\/ 11 Oct live Playo)/)![0]

function box(text: string, inputs: Array<{ value: string; type?: string; name?: string; autocomplete?: string }>, tagName = 'DIV') {
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
async function consequential(el: any) {
  return await runInNewContext(guard + 'isConsequentialControl(page,"#c")', { page: { url: () => 'https://www.croma.com/x/p/1', locator: () => ({ first: () => ({ evaluate: async (fn: any) => fn(el) }) }) }, location: { href: 'https://www.croma.com/x/p/1' } })
}

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
console.log('Store location Continue after Gogo enters the pincode is allowed in read mode; every commit stays blocked')
