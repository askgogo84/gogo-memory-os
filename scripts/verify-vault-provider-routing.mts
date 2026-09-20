import assert from 'node:assert/strict'
import { findVaultProviderInText } from '../lib/vault/providers'
import { parseConnectedProviderReadCommand } from '../lib/agent/browser-command'

assert.equal(findVaultProviderInText('Find the AI reels I saved recently on Instagram')?.key,'instagram')
assert.equal(findVaultProviderInText('Check my Amazon orders')?.key,'amazon')
assert.equal(findVaultProviderInText('Search LinkedIn for my saved post')?.key,'linkedin')
assert.equal(findVaultProviderInText('Open Flipkart wishlist')?.key,'flipkart')
assert.equal(findVaultProviderInText('Show my bookings'),null,'generic booking noun must not route to Booking.com')
assert.equal(findVaultProviderInText('Show my Booking.com reservations')?.key,'booking')
assert.equal(findVaultProviderInText('Find something on a random website'),null)

const exactInstagramRequest='Find the AI reels I saved recently on Instagram.'
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
assert.match(whatsappRoute,/tryRunWhatsAppAgent/)
