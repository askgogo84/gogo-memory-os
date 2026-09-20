import assert from 'node:assert/strict'
import { findVaultProviderInText } from '../lib/vault/providers'

assert.equal(findVaultProviderInText('Find the AI reels I saved recently on Instagram')?.key,'instagram')
assert.equal(findVaultProviderInText('Check my Amazon orders')?.key,'amazon')
assert.equal(findVaultProviderInText('Search LinkedIn for my saved post')?.key,'linkedin')
assert.equal(findVaultProviderInText('Open Flipkart wishlist')?.key,'flipkart')
assert.equal(findVaultProviderInText('Find something on a random website'),null)

const browser=await import('node:fs').then(fs=>fs.readFileSync('lib/agent/browser-command.ts','utf8'))
assert.match(browser,/parseConnectedProviderReadCommand/)
assert.match(browser,/parseBrowserCommand\(params\.text\)\|\|parseConnectedProviderReadCommand\(params\.text\)/)
assert.match(browser,/writeSignal/)
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
