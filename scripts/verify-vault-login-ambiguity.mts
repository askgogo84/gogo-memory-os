// Vault login fill must never guess between several visible login fields. A page with two
// sign-in or sign-up forms used to fill whichever field came first, and the run then reported
// "Saved login". The sandbox script now counts visible candidates, refuses when there is more
// than one, and the run reports the fill as failed. Structural check of the production source;
// the behaviour was also run locally against a single-form and a two-form page.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=readFileSync('lib/agent/secure-computer.ts','utf8')
const start=src.indexOf('const VAULT_LOGIN_SCRIPT=String.raw`')
const end=src.indexOf('`\nconst BROWSER_SCRIPT',start)
assert.ok(start>0&&end>start,'the Vault login script is present')
const login=src.slice(start,end)

assert.match(login,/async function visibleFields\(page, selector\)/,'the login script counts every visible candidate')
assert.match(login,/if\(userFields\.length>1\) ambiguous\.push\('username_fields'\)/,'several username fields are refused')
assert.match(login,/if\(passFields\.length>1\) ambiguous\.push\('password_fields'\)/,'several password fields are refused')
assert.match(login,/if\(passFields\.length===1\)\{/,'the password is typed only into a single unambiguous field')
assert.match(login,/out\.vaultLogin=\{usernameFilled,passwordFilled,submitted,ambiguous\}/,'the fill outcome, including ambiguity, is reported')
assert.doesNotMatch(login,/firstVisible\(page,\['input\[autocomplete="current-password"\]'/,'the password is no longer taken from the first visible match')

const caller=src.slice(src.indexOf("actionLog.push(vaultFilled"),src.indexOf("actionLog.push(vaultFilled")+900)
assert.match(caller,/status:'failed'/,'an unfilled login is recorded as failed, not saved')
assert.match(caller,/Gogo will not guess which one to use/,'the user is told why the fill did not happen')
assert.doesNotMatch(src,/detail:`Saved \$\{credential\.provider\} login`/,'no run claims a saved login without a confirmed fill')

console.log('Vault login ambiguity: refuses multiple candidate fields and reports the fill outcome (structural)')
