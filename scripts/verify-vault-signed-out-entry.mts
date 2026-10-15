import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hasSignInEntry, isLoginFormPage } from '../lib/agent/browser-evidence'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'
// 15 Oct live: after saving a Zomato phone login, the run read zomato.com's home page (not a login form), never tried the
// saved login, and zwstatic.zomato.com was blocked 45 times. Run: npx tsx scripts/verify-vault-signed-out-entry.mts
const zomatoHome = { url: 'https://www.zomato.com/', title: 'Zomato', text: 'Log in Sign up Order food online', links: [{ text: 'Investor Relations' }], controls: [{ label: 'Log in' }, { label: 'Sign up' }] }
assert.equal(isLoginFormPage(zomatoHome), false)
assert.equal(hasSignInEntry(zomatoHome), true)
assert.equal(hasSignInEntry({ links: [{ text: 'Sign in' }] }), true)
assert.equal(hasSignInEntry({ links: [{ text: 'Login / Sign up' }] }), true)
assert.equal(hasSignInEntry({ links: [{ text: 'Sign in to see your orders and earn rewards' }] }), false, 'only a bare header entry counts')
assert.equal(hasSignInEntry({ controls: [{ label: 'My account' }] }), false)
assert.ok('zwstatic.zomato.com' in browserPageAllowlist('https://www.zomato.com/'))
const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
assert.match(src, /const signedOutEntry=!vaultAttempted&&!vaultEntryChecked&&!authGate\.required&&!loginish&&hasSignInEntry\(page\)/)
assert.match(src, /\(!authGate\.required&&\(loginish\|\|signedOutEntry\)\)/)
console.log('verify-vault-signed-out-entry: ok')
// Second live run: the saved login was tried but no phone field was found. The opener also clicks a plain-text
// "Log in", and a miss logs field shapes only (never values).
assert.match(src, /page\.getByText\(t,\{exact:true\}\)/)
assert.match(src, /VAULT_LOGIN_NOT_FILLED:/)
assert.match(src, /\[el\.type,el\.name,el\.placeholder,el\.autocomplete\]/)
assert.doesNotMatch(src, /fieldsSeen=[^\n]*el\.value/, 'never logs what is typed')
console.log('verify-vault-signed-out-entry: diag ok')
