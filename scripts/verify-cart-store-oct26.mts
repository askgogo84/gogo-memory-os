import assert from 'node:assert/strict'
import { parseConnectedProviderCartAction } from '../lib/agent/browser-command'

// 26 Oct: "Swiggy Instamart" matched both the Instamart store and the Swiggy login provider, so no cart command was made.
const instamart = parseConnectedProviderCartAction('Add Amul Taaza toned milk 500ml to my cart on Swiggy Instamart')
assert.equal(instamart?.url, 'https://www.swiggy.com/instamart')
assert.equal(instamart?.approvalAction, 'submit_form')
assert.equal(parseConnectedProviderCartAction('Add Amul milk to my cart on Instamart')?.url, 'https://www.swiggy.com/instamart')
assert.equal(parseConnectedProviderCartAction('Add Amul milk to my cart on Blinkit')?.url, 'https://blinkit.com/')
// Two different stores stay ambiguous; an order or payment is never a cart action.
assert.equal(parseConnectedProviderCartAction('Add milk to my cart on Blinkit and Amazon'), null)
assert.equal(parseConnectedProviderCartAction('Add milk to my cart on Instamart and pay'), null)
console.log('Cart store disambiguation passed')
