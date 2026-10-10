// Generated sign-up passwords in the secure browser. The planner names the new-password field
// only (fill_secret); the backend generates the password and records it as pending BEFORE
// anything is submitted; the worker fills it from a command-scoped variable, only into a real
// password input; a verified creation commits it to the Vault, an existing account discards it,
// and anything unclear leaves it pending. Structural checks of production source. The worker was
// also run locally against a sign-up page (password delivered, absent from worker output; wrong
// field or missing variable refused with no submit).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('lib/agent/secure-computer.ts', 'utf8')
const flow = readFileSync('lib/vault/signup-credential.ts', 'utf8')
const command = readFileSync('lib/agent/browser-command.ts', 'utf8')

// Action type and normaliser: only an authorised execution may carry fill_secret, with no value.
assert.match(src, /\| \{ kind:'fill_secret'; selector:string \}/, 'fill_secret carries a selector and no value')
assert.match(src, /else if\(kind==='fill_secret'\)\{\s*\/\/[^\n]*\n\s*if\(!allowSubmit\)continue/, 'fill_secret is dropped unless the plan may authorise a consequential action')

// Worker: execute only, from the command-scoped variable, only into a password input, and a
// failed fill stops the wave so nothing is submitted without the password.
const worker = src.slice(src.indexOf("else if(a.kind==='fill_secret'){"), src.indexOf("else if(a.kind==='search_enter'){", src.indexOf("else if(a.kind==='fill_secret'){")))
assert.match(worker, /if\(payload\.mode!=='execute'\)/, 'the worker fills a generated password only in execute mode')
assert.match(worker, /process\.env\.GOGO_SIGNUP_SECRET/, 'the password comes from the command-scoped variable')
assert.match(worker, /el\.tagName==='INPUT'&&String\(el\.getAttribute\('type'\)\|\|''\)\.toLowerCase\(\)==='password'/, 'only a real password input is filled')
assert.doesNotMatch(worker, /log\.push\([^)]*signupSecret/, 'the password is never logged')
assert.match(src, /if\(a\.kind==='fill_secret'\)break;/, 'a failed password fill stops the wave before any submit')

// Host: the pending record is written before the execution starts, only for account_creation,
// for at most two fields, and a store failure stops the run.
const pendingAt = src.indexOf('signup=await beginSignupCredential(')
const startAt = src.indexOf("if(params.mode==='execute')executionStarted=true")
assert.ok(pendingAt > 0 && startAt > pendingAt, 'the pending record is written before execution starts')
assert.match(src, /approvedOperation!=='account_creation'\)throw new Error\('signup_secret_not_authorised'\)/, 'only an account_creation run may fill a generated password')
assert.match(src, /\.length>2\)throw new Error\('signup_secret_too_many_fields'\)/, 'at most a password and its confirmation')
assert.match(src, /throw new Error\(`signup_pending_unavailable:/, 'no pending record means no sign-up')
assert.match(src, /signupEnv=\{GOGO_SIGNUP_SECRET:signup\.secret\}/, 'the password is passed only as a command-scoped variable')

// Resolution: created commits, an existing account discards, anything else stays pending.
assert.match(src, /if\(signup\)signupVault=await resolveSignupCredential\(signup,accountExists\?'rejected':'created'\)/, 'verified outcomes resolve the pending record')
assert.match(src, /if\(signup&&!signupVault\)console\.error\('SIGNUP_PENDING_UNRESOLVED:',JSON\.stringify\(\{pendingId:signup\.pendingId\}\)\)/, 'an unresolved password stays pending and is logged by id only')
assert.match(flow, /if \(outcome === 'unknown'\) return 'pending'/, 'an unclear outcome never discards the password')
assert.match(flow, /await markPendingSignupCommitted\([\s\S]*return 'saved'/, 'the pending record is marked committed only after the Vault save')
assert.doesNotMatch(flow, /console\.[a-z]+\([^\n]*\bsecret\b/, 'no log line includes the password')

// Username comes from the request, never from the provider page.
const usernameFn = flow.slice(flow.indexOf('export function signupUsernameFromObjective'), flow.indexOf('export type BegunSignup'))
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
assert.match(usernameFn, /String\(objective \|\| ''\)\.match\(EMAIL\)/, 'the username is taken from the authority source')
assert.equal('Create a Hugging Face account for Goverdhan@Tipplr.in'.match(EMAIL)?.[0].toLowerCase(), 'goverdhan@tipplr.in')

// Planner is told about fill_secret only in execute mode, and the run id reaches the browser.
assert.match(src, /\$\{mode==='execute'\?'Only for approvedOperation account_creation: [^']*fill_secret/, 'the planner learns fill_secret only in execute mode')
assert.match(command, /runSecureBrowser\(\{[^)]*runId:params\.runId/, 'the run id is passed so the pending record is tied to the run')

// Multi-page sign-up (email and password, then Next, then username and terms): an approved
// account creation may fill up to MAX_SIGNUP_PAGES pages; earlier pages end with a Next click and
// no submit; the final page carries the single submit; a failed step stops before the next page.
assert.match(src, /const MAX_SIGNUP_PAGES=4/, 'a sign-up may span at most four pages (homepage step plus three)')
assert.match(src, /params\.mode==='execute'&&params\.accountCreation===true\?MAX_SIGNUP_PAGES:1/, 'only an approved account creation gets more than one page')
assert.match(src, /submitCount===0&&wave<MAX_SIGNUP_PAGES-1&&actions\[actions\.length-1\]\?\.kind==='click'/, 'an earlier page ends with a Next click and no submit, never on the last allowed page')
assert.match(src, /if\(params\.mode==='execute'&&actions\.some\(a=>a\.kind==='submit'\)\)break/, 'nothing is planned after the final submit')
assert.match(src, /if\(params\.mode==='execute'&&\(page\.actions\|\|\[\]\)\.some\(\(a:any\)=>a\.status!=='done'\)\)break/, 'a failed step stops before the next page')
assert.match(src, /params\.accountCreation!==true && \(authGate\.reason==='password'/, 'a saved login is never tried while creating an account')
assert.match(command, /runId:params\.runId,accountCreation,/, 'the account-creation flag reaches the browser')

// 10 Oct live miss: "Login to https://manus.im/ and create the account.. <email>" was saved to the
// Link Vault instead of starting an account sign-up.
{
  const { parseExternalAccountRequest } = await import('../lib/agent/external-account-intent.ts')
  const manus = parseExternalAccountRequest('Login to https://manus.im/ and create the account.. goverdhan.md@gmail.com')
  assert.equal(manus?.service, 'manus.im', 'create the account on a linked site is an account request')
  assert.equal(manus?.email, 'goverdhan.md@gmail.com')
  assert.equal(manus?.url, 'https://manus.im/')
  const vault = readFileSync('lib/services/link-vault.ts', 'utf8')
  assert.match(vault, /if\(parseExternalAccountRequest\(text\)\|\|mentionsExternalAccountCreation\(text\)\)return false/, 'an account request is never saved as a link')
  const acct = readFileSync('lib/agent/external-account.ts', 'utf8')
  assert.match(acct, /looksLikeSignupUrl\(request\.url\)\|\|isHomepageUrl\(request\.url\)/, "the user's own homepage link is accepted for an unregistered site")
}

// 10 Oct live run a2ae7e03: the sign-up page's password field was read as a sign-in wall and the
// run stopped with no steps. While creating an account, a password field never pauses the run.
assert.match(src, /const signupPasswordField=params\.accountCreation===true&&\(!authGate\.required\|\|authGate\.reason==='password'\)/, 'a sign-up password field is not a sign-in wall')
assert.match(src, /if\(!signupPasswordField&&\(authGate\.required\|\|pageLooksLikeLogin\(page\)\)\)\{/, 'the in-run gate skips only the sign-up password case')
assert.match(src, /if\(!finalSignupPasswordField&&\(finalAuthGate\.required\|\|pageLooksLikeLogin\(page\)\)\)\{/, 'the final gate skips only the sign-up password case')

// Resume after the person completes a human check: the same run reuses its pending password, and a
// page that already shows the account (or asks to confirm the email) commits it to the Vault.
assert.match(flow, /const existing = await resumeSignupCredential\(/, 'a resumed run reuses its pending password')
assert.match(src, /resumedSignupCreated=params\.mode==='execute'&&params\.accountCreation===true&&params\.resumePage===true/, 'only a resumed account creation can use the page as evidence')
assert.match(src, /!actionLog\.some\(a=>a\.kind==='submit'&&a\.status==='done'\)&&RESUMED_SIGNUP_CREATED\.test/, 'the page counts only when nothing was submitted in this resume')
{
  const m = src.match(/const RESUMED_SIGNUP_CREATED=(\/.+\/i)\n/)
  assert.ok(m, 'the resumed-success pattern exists')
  const re = new Function(`return ${m![1]}`)() as RegExp
  for (const t of ['Your account has been created', 'Please confirm your email address', 'Check your email to activate', "We've sent you a confirmation email"]) assert.ok(re.test(t), t)
  for (const t of ['Complete your profile', 'Create Account', 'Unknown h-captcha error.', 'Join Hugging Face']) assert.ok(!re.test(t), t)
}

// Live run d27946ab: the last page's plan filled username, name and terms but left the final button
// for the CAPTCHA, and the run was thrown away as unverified. Now the fills run and the final step is
// handed to the person; nothing is submitted by Gogo, so the password stays pending until resume.
assert.match(src, /const signupFillThenHandoff=params\.mode==='execute'&&params\.accountCreation===true&&plan\.operation==='account_creation'\s*&&submitCount===0&&actions\.length>0&&actions\.every\(a=>\['fill','fill_secret','select','check'\]\.includes\(a\.kind\)\)/, 'a fill-only last page is allowed only for an approved account creation')
assert.match(src, /if\(signupHandoffAfterWave&&\(page\.actions\|\|\[\]\)\.every\(\(a:any\)=>a\.status==='done'\)\)\{/, 'the handoff happens only after every fill succeeded')
assert.match(src, /Gogo filled in the whole sign-up form\. The last step needs you/, 'the person is told exactly what is left')
assert.match(src, /BROWSER_EXECUTE_PLAN_REJECTED:/, 'a rejected execute plan is logged with its action kinds')

// Username and name are collected in chat before approval (Instinct-style), never invented.
const { parseAccountProfile } = await import('../lib/agent/external-account-intent.ts')
assert.deepEqual(parseAccountProfile('username goverdhan-md, name Goverdhan M D'), { username: 'goverdhan-md', fullName: 'Goverdhan M D' })
assert.deepEqual(parseAccountProfile('Username: gogo84 Name: Goverdhan M D'), { username: 'gogo84', fullName: 'Goverdhan M D' })
assert.deepEqual(parseAccountProfile('username is goverdhan_md'), { username: 'goverdhan_md', fullName: null })
assert.equal(parseAccountProfile('name Goverdhan'), null, 'a name alone is not a profile answer')
assert.equal(parseAccountProfile('what is the weather in Bengaluru'), null)
const account = readFileSync('lib/agent/external-account.ts', 'utf8')
assert.match(account, /stage:'profile'/, 'the flow asks for the username and name before approval')
assert.match(account, /never pick another one/, 'a taken username is reported, never replaced')

console.log('Sign-up credential flow: fill_secret gating, pending-before-submit, resolution and no-leak checks passed (structural)')
