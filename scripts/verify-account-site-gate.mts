import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 15 Oct: "Check my last Amazon order" with no Amazon sign-in timed out with "the provider site took longer than
// WhatsApp's safe response window". It now asks for the sign-in first. Run: npx tsx scripts/verify-account-site-gate.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { accountSiteFromText, signInFirstReply, CONNECTIONS_URL } = await import('../lib/agent/account-site-gate')
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const id = (t: string) => accountSiteFromText(t)?.id || null

assert.equal(id('Check my last Amazon order'), 'amazon')
assert.equal(id('where is my flipkart delivery'), 'flipkart')
assert.equal(id('show my myntra returns'), 'myntra')
assert.equal(id('what did I order on amazon.in, my orders please'), 'amazon')
assert.equal(id('my Uber rides this week'), 'uber')
assert.equal(id('cancel my zomato order'), 'zomato')
assert.equal(id('my orders on Nykaa'), 'nykaa')
assert.equal(id('show my IndiGo ticket'), null, 'saved tickets are answered from Gogo, not the site')
assert.equal(id('find my Amsterdam flight ticket'), null)
assert.equal(id('compare AirPods prices on Amazon and Flipkart'), null, 'not about the person’s own account')
assert.equal(id('check my booking'), null, 'booking alone is not Booking.com')
assert.equal(id('my swiggy order'), 'swiggy', 'Swiggy order questions: emails first, then phone-code connect (its official connector awaits approval)')
assert.equal(id('order biryani on swiggy'), null, 'placing food orders stays with the Swiggy food flow')
assert.equal(id('my order'), null)

// Amazon is a vault site: the reply links to Connect (verify-connect-from-chat). Myntra keeps the Settings sign-in.
const reply = signInFirstReply(accountSiteFromText('show my myntra returns')!)
assert.ok(reply.includes(CONNECTIONS_URL) && reply.includes('Myntra') && reply.includes('never sees your password'))
assert.doesNotMatch(reply, /provider|persistent|context/i, 'plain words')

const bridge = read('lib/agent/whatsapp-bridge.ts')
assert.match(bridge, /const accountGate = await tryAccountSiteAnswer\(actor, text\)/)
assert.doesNotMatch(bridge, /safe response window/)
assert.match(read('app/api/dashboard/chat/route.ts'), /const accountGate = await tryAccountSiteAnswer\(actor, text\)/)
// 26 Oct live: "Add Amul milk to my cart on Instamart" was answered with old order emails; cart actions skip that answer.
const { isCartAction } = await import('../lib/agent/account-site-gate')
assert.equal(isCartAction('Add Amul Taaza toned milk 500 ml to my cart on Instamart. Do not order or pay.'), true)
assert.equal(isCartAction('add bread to the basket on blinkit'), true)
assert.equal(isCartAction('what is in my Instamart cart'), false, 'reading the cart is still an account question')
assert.equal(isCartAction('where is my flipkart delivery'), false)
const gateSrc = read('lib/agent/account-site-gate.ts')
assert.ok(gateSrc.indexOf('if (isCartAction(text))') > 0 && gateSrc.indexOf('if (isCartAction(text))') < gateSrc.indexOf("const { tryOrderStatusFromEmail } = await import('./order-email-status')\n  const fromEmail"), 'cart actions return before the order-email answer')
console.log('verify-account-site-gate: ok')
