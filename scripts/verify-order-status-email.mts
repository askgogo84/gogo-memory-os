import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 15 Oct live: amazon.in answered Gogo's cloud browser with "503 - Service Unavailable". Order questions are answered
// from the shop's own emails first. Run: npx tsx scripts/verify-order-status-email.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { isOrderStatusQuestion, orderEmailQuery, formatOrderEmailAnswer } = await import('../lib/agent/order-email-status')
const { findCatalogueSite } = await import('../lib/dashboard/connection-catalogue')
const { managedSessionConfig } = await import('../lib/agent/managed-browser')
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const amazon = findCatalogueSite('amazon')!

assert.equal(isOrderStatusQuestion('Where is my Amazon order?'), true)
assert.equal(isOrderStatusQuestion('when will my flipkart delivery arrive'), true)
assert.equal(isOrderStatusQuestion('show my amazon wishlist'), false, 'only orders and deliveries come from email')
assert.equal(orderEmailQuery(amazon), 'from:(amazon.in) newer_than:45d -category:promotions (order OR ordered OR shipped OR dispatched OR delivered OR delivery OR "out for delivery" OR arriving)')
assert.equal(orderEmailQuery(findCatalogueSite('irctc')!), null)

const answer = formatOrderEmailAnswer(amazon, [
  { subject: 'Your Amazon.in order of "Huawei FreeClip 2..." has shipped', date: 'Thu, 15 Oct 2026 09:10:00 +0000', snippet: 'Arriving tomorrow 8 am - 12 pm. Track package' },
  { subject: 'Delivered: microfiber cloth roll', date: 'Thu, 15 Oct 2026 02:00:00 +0000', snippet: 'Your package was delivered.' },
])!
assert.match(answer, /^From your Amazon\.in emails, the latest order update:/)
assert.match(answer, /\*Your Amazon\.in order of "Huawei FreeClip 2\.\.\." has shipped\*/)
assert.match(answer, /Arriving tomorrow 8 am - 12 pm/)
assert.match(answer, /Before that:\n• Delivered: microfiber cloth roll/)
assert.equal(formatOrderEmailAnswer(amazon, []), null)

// Email first on the dashboard and WhatsApp; the Connect link is added only when the site is not connected.
const gate = read('lib/agent/account-site-gate.ts')
assert.match(gate, /const fromEmail = await tryOrderStatusFromEmail\(actor, site, text\)/)
assert.match(gate, /const connectLine = gate && VAULT_CONNECT_SITES\[site\.id\]/)
assert.match(read('app/api/dashboard/chat/route.ts'), /const accountGate = await tryAccountSiteAnswer\(actor, text\)/)
assert.match(read('lib/agent/whatsapp-bridge.ts'), /const accountGate = await tryAccountSiteAnswer\(actor, text\)/)

// Advanced Stealth is opt-in and never solves CAPTCHAs.
const plain = managedSessionConfig('p', 'c', 'o', 'amazon.in', 300, true, 'production', false) as any
assert.equal(plain.browserSettings.advancedStealth, undefined)
const stealth = managedSessionConfig('p', 'c', 'o', 'amazon.in', 300, true, 'production', false, true) as any
assert.equal(stealth.browserSettings.advancedStealth, true)
assert.equal(stealth.browserSettings.solveCaptchas, false)
console.log('verify-order-status-email: ok')

// 15 Oct live: Amazon pads the preview with U+034F and repeats the subject; the answer shows the subject once.
const padded = formatOrderEmailAnswer(amazon, [{ subject: 'Ordered: "Huawei FreeClip 2, Open-Ear..."', date: 'Thu, 15 Oct 2026 07:57:00 +0000', snippet: 'Ordered: "Huawei FreeClip 2, Open-Ear..."͏ ͏ ͏ ͏' }])!
assert.doesNotMatch(padded, /͏/)
assert.equal(padded.match(/Huawei FreeClip 2/g)?.length, 1)
console.log('verify-order-status-email: padding ok')

// 15 Oct: Swiggy and Zomato. Swiggy order emails come from swiggy.in; its card offers are dropped by subject.
const { orderUpdatesOnly } = await import('../lib/agent/order-email-status')
const { accountSiteFromText } = await import('../lib/agent/account-site-gate')
const { VAULT_CONNECT_SITES } = await import('../lib/dashboard/connection-catalogue')
const { getVaultProvider } = await import('../lib/vault/providers')
assert.equal(accountSiteFromText('Where is my Swiggy order?')?.id, 'swiggy')
assert.equal(accountSiteFromText('Where is my Zomato order?')?.id, 'zomato')
assert.match(orderEmailQuery(findCatalogueSite('swiggy')!)!, /^from:\(swiggy\.in\)/)
assert.deepEqual(orderUpdatesOnly([{ subject: 'Zero fees. Zero regrets. ✅' }, { subject: 'Your Swiggy order was delivered on time' }]).map(m => m.subject), ['Your Swiggy order was delivered on time'])
for (const id of ['swiggy', 'zomato']) {
  assert.equal(VAULT_CONNECT_SITES[id], id)
  assert.equal(getVaultProvider(id)!.phoneOnly, true, `${id} signs in only with a phone and code`)
}
assert.match(read('components/dashboard/connect-site-form.tsx'), /\{!props\.phoneOnly && option\('password', 'Password'\)\}/)
const script = read('lib/agent/secure-computer.ts')
assert.match(script, /Sites like Swiggy and Zomato keep the login in a panel opened from the header/)
assert.match(script, /button:has-text\("Send One Time Password"\)/)
console.log('verify-order-status-email: swiggy/zomato ok')
