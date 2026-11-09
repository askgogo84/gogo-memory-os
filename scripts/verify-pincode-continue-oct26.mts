// 26 Oct live (Croma): Gogo filled the delivery pincode but the read-mode guard skipped the dialog's Continue button
// ("fill:done","click:skipped"), so the page never showed delivery for 560086. A plain Continue/Apply inside a
// delivery-location box holding a filled 6-digit pincode now counts as setting the location, not a commit.
// Offline. Run: npx --yes tsx scripts/verify-pincode-continue-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const guard = src.match(/async function isConsequentialControl\(page,selector,onUnavailable,onContext\)\{[\s\S]*?\n\}\n(?=\/\/ 11 Oct live Playo)/)![0]

function box(text: string, inputs: Array<{ value: string; type?: string }>) {
  return {
    textContent: text, getAttribute: () => null,
    querySelectorAll: (sel: string) => sel === 'input' ? inputs : [],
    querySelector: (sel: string) => sel.includes('password') ? inputs.find(i => i.type === 'password') || null : null,
  }
}
function button(label: string, container: any, extra: Record<string, any> = {}) {
  return { tagName: 'BUTTON', textContent: label, id: '', form: null, disabled: false, innerText: label,
    getAttribute: (k: string) => (k in extra ? extra[k] : null),
    closest: (sel: string) => (sel.includes('dialog') || sel.includes('form') ? container : null) }
}
async function consequential(el: any) {
  return await runInNewContext(guard + 'isConsequentialControl(page,"#c")', { page: { url: () => 'https://www.croma.com/x/p/1', locator: () => ({ first: () => ({ evaluate: async (fn: any) => fn(el) }) }) }, location: { href: 'https://www.croma.com/x/p/1' } })
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
// 9 Nov (#953 assessors): payment, email and phone contexts are never a location box, even with a 6-digit value.
assert.equal(await consequential(button('Continue', box(LOC + ' Payment details', [{ value: '560086' }]))), true, 'payment details context')
assert.equal(await consequential(button('Continue', box('Payment', [{ value: '560086' }]))), true, 'bare payment box')
assert.equal(await consequential(button('Continue', box(LOC + ' Email address', [{ value: '560086' }]))), true, 'email context')
assert.equal(await consequential(button('Continue', box(LOC + ' Phone number', [{ value: '560086' }]))), true, 'phone context')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }, { value: 'divya@example.com', type: 'email' }]))), true, 'email input nearby')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }, { value: '9876543210', type: 'tel' }]))), true, 'phone input nearby')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }, { value: 'Nithin' }]))), true, 'a second filled field (an address or name form) is not a pincode box')
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '123456', getAttribute: (k: string) => (k === 'autocomplete' ? 'one-time-code' : null) } as any]))), true, 'a one-time-code input is not a pincode')
// Positive control still allowed after tightening.
assert.equal(await consequential(button('Continue', box(LOC, [{ value: '560086' }, { value: '', type: 'hidden' }]))), false, 'hidden inputs do not count as fields')
console.log('Store location Continue after Gogo enters the pincode is allowed in read mode; every commit stays blocked')
