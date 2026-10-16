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
assert.match(src, /let signedOutEntry=!params\.loginCode&&!vaultAttempted&&!vaultEntryChecked&&!authGate\.required&&!loginish&&hasSignInEntry\(page\)/)
assert.match(src, /\(!authGate\.required&&\(loginish\|\|signedOutEntry\)\)/)
console.log('verify-vault-signed-out-entry: ok')
// Second live run: the saved login was tried but no phone field was found. The opener also clicks a plain-text
// "Log in", and a miss logs field shapes only (never values).
assert.match(src, /page\.getByText\(t,\{exact:true\}\)/)
assert.match(src, /VAULT_LOGIN_NOT_FILLED:/)
assert.match(src, /\[el\.type,el\.name,el\.placeholder,el\.autocomplete\]/)
assert.doesNotMatch(src, /fieldsSeen=[^\n]*el\.value/, 'never logs what is typed')
console.log('verify-vault-signed-out-entry: diag ok')
// Third live run: the planner went to a page with no "Log in" link and the saved login was never tried. Phone-code
// sites sign in once at the start unless an active vault session exists for that site.
assert.match(src, /if\(phoneSite\?\.phoneOnly\|\|\(phoneSite\?\.phoneLogin&&params\.phoneLogin\?\.number\)\)\{/)
assert.match(src, /signedOutEntry=!!sessions&&!sessions\.some\(row=>row\.status==='active'/)
assert.match(src, /signInEntry:hasSignInEntry\(page\),loginForm:pageLooksLikeLogin\(page\)/)
console.log('verify-vault-signed-out-entry: start-of-run ok')
// 16 Oct 10:13 live: Swiggy's panel opened after Gogo looked for the phone box (fieldsSeen: only the location box).
assert.match(src, /for\(let i=0;i<20;i\+\+\)\{ await page\.waitForTimeout\(500\); if\(\(await visibleFields\(page,USER_FIELDS\)\)\.length\) break; \}/)
// 16 Oct 10:12 live: one proxy tunnel error failed the whole read; the first navigation is retried once.
assert.equal((src.match(/ERR_TUNNEL_CONNECTION_FAILED\|ERR_PROXY_CONNECTION_FAILED\|ERR_CONNECTION_RESET/g) || []).length, 2)
console.log('verify-vault-signed-out-entry: panel wait ok')
