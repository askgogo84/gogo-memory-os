import assert from 'node:assert/strict'
import { findVaultProviderInText } from '../lib/vault/providers'
import { parseConnectedProviderReadCommand, isExplicitProviderBrowserRead } from '../lib/agent/browser-command'
import { redactSecretShapedText } from '../lib/bot/memory-redaction'

for(const secret of ['PIN 4821','PIN code 4821','password: hunter2','OTP 903112','My PIN if needed is 4821','PIN code if required: 4821','password if needed is hunter2','My PIN if needed? 4821','My PIN if needed. It is 4821','My PIN if needed, 4821','My PIN if needed; 4821']){
  const text=`Read the account. Do not order anything. ${secret}`
  const redacted=redactSecretShapedText(text)
  assert.ok(redacted.includes('Do not order anything.'),'keep the restriction preceding a real secret')
  assert.ok(!redacted.includes(secret.split(' ').at(-1)!),'redact actual credentials after the instructional phrase')
}

assert.equal(findVaultProviderInText('Find the AI reels I saved recently on Instagram')?.key,'instagram')
assert.equal(findVaultProviderInText('Check my Amazon orders')?.key,'amazon')
assert.equal(findVaultProviderInText('Search LinkedIn for my saved post')?.key,'linkedin')
assert.equal(findVaultProviderInText('Open Flipkart wishlist')?.key,'flipkart')
assert.equal(findVaultProviderInText('Show my bookings'),null,'generic booking noun must not route to Booking.com')
assert.equal(findVaultProviderInText('Show my Booking.com reservations')?.key,'booking')
assert.equal(findVaultProviderInText('Find something on a random website'),null)

const exactInstagramRequest='Find the AI reels I saved recently on Instagram.'
const screenshotInstagram='Open Instagram and show me the 3 most recent posts in my Saved collection. Do not like, comment, follow, message, post, or change anything.'
const screenshotBlinkit='Open Blinkit and check availability and the current price of Amul Taaza toned milk, 1 litre, for my delivery location. Ask me for my area and PIN code if needed. Do not order anything. If login is required, let me take control. After I authenticate, resume this same task and tell me the price.'
assert.ok(isExplicitProviderBrowserRead(screenshotInstagram))
assert.ok(isExplicitProviderBrowserRead(screenshotBlinkit))
assert.equal(isExplicitProviderBrowserRead('What did I tell you about my Amazon order?'),false)
const conditionalPin=parseConnectedProviderReadCommand('Open Amazon and show my orders. Ask me for my PIN code if needed. It is 4821.')
assert.ok(conditionalPin)
assert.ok(!conditionalPin.objective.includes('4821'),'an authentication PIN must never become a postal code')
assert.ok(!redactSecretShapedText('For Amazon login, my PIN if needed, use 4821').includes('4821'))
for(const [input,host] of [
  [screenshotInstagram,'www.instagram.com'],
  [screenshotBlinkit,'blinkit.com'],
  ['Open Instamart and check milk prices. Do not buy, pay, or order anything.','www.swiggy.com'],
  ['Check milk availability on Zepto. Don’t purchase anything.','www.zepto.com'],
  ['Check my Amazon order','www.amazon.in'],
  ['Show my latest Instagram message','www.instagram.com'],
  ['Where is my Amazon order?','www.amazon.in'],
  ['What is the status of my Amazon order?','www.amazon.in'],
  ['When will my Blinkit order arrive?','blinkit.com'],
  ['When will Amazon deliver my order?','www.amazon.in'],
  ['Did Amazon cancel my order?','www.amazon.in'],
  ['Update me on my Amazon order','www.amazon.in'],
  ['Open my Amazon order','www.amazon.in'],
  ['Open my latest Instagram message','www.instagram.com'],
  ['Open Instagram and show recent posts from Blinkit','www.instagram.com'],
  ['Check whether milk is available at my place on Blinkit','blinkit.com'],
  ['Will Amazon cancel my order?','www.amazon.in'],
  ['Does Amazon confirm my order?','www.amazon.in'],
  ['Show my Blinkit purchase history','blinkit.com'],
  ['Check my Amazon order and latest message','www.amazon.in'],
  ['Check my Amazon order, and latest message','www.amazon.in'],
  ['Check my Amazon order status and latest message','www.amazon.in'],
  ["What's the price of Amul milk on Blinkit?",'blinkit.com'],
  ['Is Amul milk available on Zepto?','www.zepto.com'],
  ['Open Blinkit. Ask for my PIN code if needed. Then check the price of milk. Do not order.','blinkit.com'],
  ['Open Blinkit. Ask me for my area and PIN code if needed and check the price of milk','blinkit.com'],
  ['Open Blinkit and check the price; do not place an order.','blinkit.com'],
  ['Open Blinkit and check the price. Do not make an order or add to my cart.','blinkit.com'],
] as const){
  const command=parseConnectedProviderReadCommand(input)
  assert.ok(command,input)
  assert.equal(new URL(command.url).hostname,host)
  assert.equal(command.mode,'read')
  assert.equal(command.approvalAction,undefined)
  const expected=input.includes('area and PIN code')?input.replace('PIN code','postal code'):input.replace('PIN code if needed','PIN [sensitive detail withheld]')
  assert.equal(command.objective,expected,'retain objective and human-auth restrictions; normalize only the explicitly postal label')
}
for(const input of [
  'Open Instagram and show saved posts. Do not like posts, but follow this account.',
  'Open Instagram and show saved posts. Do not like, comment, or change anything. Follow this account.',
  'Open Instagram and publish a post. Do not like anything.',
  'Open Blinkit and buy milk. Do not change my address.',
  'Open Zepto and order two cartons of milk.',
  'Order milk on Blinkit',
  'Order four cartons on Zepto',
  'Open Instagram. Do not like anything. Message Bob.',
  'Check my Amazon order then order milk.',
  'Show my latest Instagram message and message Bob.',
  'Place an order for milk on Blinkit.',
  'Open Blinkit and add milk to my cart',
  'Open Blinkit and put milk in my cart',
  'Open Zepto and move milk to my basket',
  'Open Blinkit and save 12 Main St as my delivery address',
  'Open Blinkit and apply coupon SAVE20',
  'Open Zepto and redeem a coupon',
  'Open Blinkit to order milk',
  'Open Reddit and show posts about Blinkit',
  'Check my Amazon order and message Bob',
  'Check my Amazon order to message the seller',
  'Check my Amazon order before you order milk',
  'Open Zepto and remove milk from the basket',
  'Open Instamart and empty my cart',
  'Open Blinkit and reorder milk',
  'Place my order on Blinkit',
  'Complete my order on Zepto',
  'Confirm my Blinkit order',
  'Did Amazon cancel my order? Cancel my other order.',
  'Open Blinkit and make an order for milk',
  'Open Blinkit and create an order for milk',
  'Check my Amazon order, order milk',
  'Will you order milk on Blinkit?',
  'Will you message Bob on Instagram?',
  'Remind me to check milk prices on Blinkit tomorrow.',
  'Compare milk prices on Blinkit, Instamart, and Zepto.',
  'Open Instagram and show posts from Blinkit, then open Blinkit and check milk prices',
])assert.equal(parseConnectedProviderReadCommand(input),null,'must not downgrade a mutation or truncate a multi-provider task: '+input)
const exactCommand=parseConnectedProviderReadCommand(exactInstagramRequest)
assert.equal(exactCommand?.mode,'read')
assert.match(String(exactCommand?.url||''),/instagram\.com/)
assert.match(String(exactCommand?.objective||''),/Find the AI reels I saved recently on Instagram/)

for (const [input,host] of [
  ['Check my Amazon orders','amazon.in'],
  ['Search LinkedIn for my saved post','linkedin.com'],
  ['Open Flipkart wishlist','flipkart.com'],
] as const) {
  const command=parseConnectedProviderReadCommand(input)
  assert.equal(command?.mode,'read',input+' must remain a provider read')
  assert.match(String(command?.url||''),new RegExp(host.replace('.', '\\.') ))
}

assert.equal(
  parseConnectedProviderReadCommand('save this as a reminder: check my Amazon orders tomorrow'),
  null,
  'explicit reminder commands must not be stolen by provider-read preflight',
)
assert.equal(
  parseConnectedProviderReadCommand('add check my Amazon orders to my calendar tomorrow at 9am'),
  null,
  'explicit calendar commands must keep deterministic routing',
)

const browser=await import('node:fs').then(fs=>fs.readFileSync('lib/agent/browser-command.ts','utf8'))
assert.match(browser,/parseConnectedProviderReadCommand/)
assert.match(browser,/parseBrowserCommand\(params\.text\)\|\|parseConnectedProviderReadCommand\(params\.text\)/)
assert.match(browser,/writeTokens/)
assert.match(browser,/readTokens/)
assert.match(browser,/mode:'read'/)

const watchers=await import('node:fs').then(fs=>fs.readFileSync('lib/agent/watchers.ts','utf8'))
assert.match(watchers,/human_auth_required/)
assert.match(watchers,/buildVaultAddLink/)
assert.match(watchers,/Don.t send your password here/)

console.log('Vault provider routing/background integration passed')

const dashboardChat=await import('node:fs').then(fs=>fs.readFileSync('app/api/dashboard/chat/route.ts','utf8'))
assert.match(dashboardChat,/tryRunBrowserCommand/)
assert.ok(
  dashboardChat.indexOf("tryRunBrowserCommand({ actor, surface:'web', text })") <
  dashboardChat.indexOf('tryRunGeneralPlan({'),
  'Vault-backed provider browser tasks must beat the dashboard generic planner',
)

const whatsappRoute=await import('node:fs').then(fs=>fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8'))
const providerPreflight=whatsappRoute.indexOf('if (parseConnectedProviderReadCommand(text))')
const legacyFeature=whatsappRoute.indexOf('const featureReply = await routeFeatureIntent')
assert.ok(providerPreflight>=0,'WhatsApp must have a provider-browser preflight')
assert.ok(legacyFeature>providerPreflight,'Vault-backed provider tasks must beat legacy feature routing on WhatsApp')
assert.ok(whatsappRoute.indexOf('const jevIntent=')<providerPreflight,'Memory questions retain semantic specialist first refusal')
assert.match(whatsappRoute,/if\(jevIntent&&!isExplicitProviderBrowserRead\(text\)\)/,'Explicit navigation must bypass semantic memory/save promotion')
assert.match(whatsappRoute,/tryRunWhatsAppAgent/)
