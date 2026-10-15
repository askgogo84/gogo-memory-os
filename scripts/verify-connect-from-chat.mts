import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// Approved mock 15 Oct: "Where is my Amazon order?" -> Connect Amazon.in card -> save phone or password in the vault ->
// the question runs again. Run: npx tsx scripts/verify-connect-from-chat.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { accountSiteFromText, signInFirstReply } = await import('../lib/agent/account-site-gate')
const { connectPath, findCatalogueSite, VAULT_CONNECT_SITES } = await import('../lib/dashboard/connection-catalogue')
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// The reply carries a one-tap connect link that brings the question back.
const amazon = findCatalogueSite('amazon')!
assert.equal(connectPath(amazon, 'Where is my Amazon order?'), '/dashboard/connect/amazon?ask=Where%20is%20my%20Amazon%20order%3F')
const reply = signInFirstReply(accountSiteFromText('Where is my Amazon order?')!, 'Where is my Amazon order?')
assert.match(reply, /https:\/\/app\.askgogo\.in\/dashboard\/connect\/amazon\?ask=Where%20is%20my%20Amazon%20order%3F/)
assert.match(reply, /sealed in your Gogo vault and never goes through chat/)
assert.match(reply, /carry on with your question/)
assert.ok(VAULT_CONNECT_SITES.flipkart && !VAULT_CONNECT_SITES.myntra)
assert.match(signInFirstReply(findCatalogueSite('myntra')!), /dashboard\/settings\?section=connections/, 'other sites keep the Settings sign-in')

// A saved vault login counts as connected.
const gate = read('lib/agent/account-site-gate.ts')
assert.match(gate, /saved\.some\(item => item\.status === 'active'/)

// Phone and text code: the number only; codes are never saved; a password and a phone login never mix.
const store = read('lib/vault/credential-store.ts')
assert.match(store, /\(!secret&&!phoneCode\)\|\|\(secret&&phoneCode\)/)
const api = read('app/api/dashboard/vault/route.ts')
assert.match(api, /secret:phoneCode\?'':secret/)
assert.match(api, /login_method:phoneCode\?'phone_code':'password'/)
assert.match(api, /error:'invalid_phone'/)

// The browser fills the saved number and asks the site to text a code; it never types a code itself.
const browser = read('lib/agent/secure-computer.ts')
assert.match(browser, /const phoneCode = !secret;/)
assert.match(browser, /'a:has-text\("Get an OTP"\)'/)
assert.match(browser, /out\.vaultLogin=\{usernameFilled,passwordFilled:false,submitted,ambiguous,phoneCode:true,codeRequested\};/)

// The connect page and chat: method choice, back to chat with the question, Connect button, auto-send once.
const form = read('components/dashboard/connect-site-form.tsx')
assert.match(form, /useState<Method>\('phone_code'\)/, 'phone and text code is the default')
assert.match(form, /\/dashboard\/chat\?ask=\$\{encodeURIComponent\(props\.ask\)\}/)
const chat = read('components/dashboard/gogo-chat.tsx')
assert.match(chat, /function connectCard\(text:string\)/)
assert.match(chat, /if\(loading\|\|!askAfterConnect\|\|askedAfterConnect\.current\)return/)

// WhatsApp: a connected account read runs in the background and answers there.
const bridge = read('lib/agent/whatsapp-bridge.ts')
assert.match(bridge, /queueBrowserRead\(\{ actor, surface:'whatsapp', text:params\.text \}\)/)
assert.match(read('lib/agent/browser-command.ts'), /const command=parseBrowserCommand\(params\.text\)\|\|parseConnectedProviderReadCommand\(params\.text\)/)
assert.doesNotMatch(read('lib/agent/approved-browser-worker.ts'), /couldn't read the free slots on \$\{host\}/)

// Settings shows a saved login as connected, offers Connect for vault sites, and Remove deletes the login.
const sessions = read('lib/dashboard/site-sessions.ts')
assert.match(sessions, /via: 'vault'/)
assert.match(sessions, /await removeVaultCredential\(String\(actor\.legacyTelegramId\), item\.id\)/)
assert.match(read('components/dashboard/settings-view.tsx'), /VAULT_CONNECT_SITES\[site\.id\] \? <Link href=\{connectPath\(site\)\}/)
console.log('verify-connect-from-chat: ok')
