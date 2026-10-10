// When Gogo cannot finish creating an account (a CAPTCHA, an unclear last step, a limited site),
// it hands the task back in one clear message instead of "the provider outcome could not be
// verified": the reason, whether anything was submitted, the exact details, the sign-up link, and
// the Vault entry that holds the generated password (viewable by its owner in the dashboard).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { buildSignupHandback, signupProfileFromObjective } = await import('../lib/agent/signup-handback.ts')

const objective = 'Create an account on Hugging Face (huggingface.co) using email goverdhan@tipplr.in, username goverdhan-md and full name Goverdhan M D.\nEnter exactly these values.'
assert.deepEqual(signupProfileFromObjective(objective), { email: 'goverdhan@tipplr.in', username: 'goverdhan-md', fullName: 'Goverdhan M D' })
assert.deepEqual(signupProfileFromObjective('Create an account on Manus (manus.im) using email A@B.in, username gogo84.'), { email: 'a@b.in', username: 'gogo84', fullName: null })

const base = { signupUrl: 'https://huggingface.co/join', objective, vaultUrl: 'https://app.askgogo.in/dashboard/you/vault' }

// The live 18:43 case: unverified, nothing submitted, password saved.
const unverified = buildSignupHandback({ ...base, reason: 'unverified', submitted: false, vault: 'saved', vaultLabel: 'Hugging Face – goverdhan@tipplr.in' })
assert.match(unverified, /^Hugging Face account not created: Gogo could not confirm the last step on the page\. Nothing was submitted\./)
assert.match(unverified, /You can finish it here: https:\/\/huggingface\.co\/join\nUse email goverdhan@tipplr\.in, username goverdhan-md, name Goverdhan M D\./)
assert.match(unverified, /saved the password in your Vault as "Hugging Face – goverdhan@tipplr\.in"\. Open it here to view or copy it: https:\/\/app\.askgogo\.in\/dashboard\/you\/vault/)
assert.doesNotMatch(unverified, /possible submission|could not be verified after/i, 'the vague message is gone')
assert.doesNotMatch(unverified, /Take control/, 'no takeover offer when no session was kept')

// CAPTCHA with the form filled: the takeover link is offered second.
const captcha = buildSignupHandback({ ...base, reason: 'captcha', submitted: false, vault: 'saved', vaultLabel: 'Hugging Face – goverdhan@tipplr.in', takeoverUrl: 'https://app.askgogo.in/dashboard/activity/r1/browser' })
assert.match(captcha, /^Hugging Face account not created: it hit a CAPTCHA that only a person can complete\. Nothing was submitted\./)
assert.ok(captcha.indexOf('You can finish it here') < captcha.indexOf("Or finish in Gogo's browser"), 'the plain handback comes first')
assert.match(captcha, /https:\/\/app\.askgogo\.in\/dashboard\/activity\/r1\/browser/)

// A submit happened but nothing confirmed it: say so, point to the email, never claim success.
const submitted = buildSignupHandback({ ...base, reason: 'unverified', submitted: true, vault: 'saved', vaultLabel: 'x', takeoverUrl: 'https://app.askgogo.in/t' })
assert.match(submitted, /Gogo pressed the final button, but could not confirm the account exists\. Check your email for a message from Hugging Face first/)
assert.doesNotMatch(submitted, /Nothing was submitted/)
assert.doesNotMatch(submitted, /Or finish in Gogo's browser/, 'no takeover after a submit')

// No password saved: never point at the Vault.
const noVault = buildSignupHandback({ ...base, reason: 'error', submitted: false, vault: null })
assert.match(noVault, /Choose your own password on the site\./)
assert.doesNotMatch(noVault, /Vault as/)
for (const text of [unverified, captcha, submitted, noVault]) assert.match(text, /Never send passwords or codes in chat\./)

// Wiring: every non-success account-creation path hands back; the password is saved as a handback.
const command = readFileSync('lib/agent/browser-command.ts', 'utf8')
const flow = readFileSync('lib/vault/signup-credential.ts', 'utf8')
const store = readFileSync('lib/vault/credential-store.ts', 'utf8')
const src = readFileSync('lib/agent/secure-computer.ts', 'utf8')
const catchAt = command.indexOf("if(accountCreation&&params.mode==='execute'){")
assert.ok(catchAt > 0 && catchAt < command.indexOf("if(runMetadata.browser_safe_to_retry===false){\n      const outcome=await (await import('./post-auth-outcome')).markAuthOutcomeUnknown"), 'the handback runs before the vague outcome-unknown path')
assert.match(command, /if\(accountCreation&&result\.authReason==='captcha'\)\{/, 'a CAPTCHA pause hands back with the takeover as a second option')
assert.match(command, /if\(accountCreation&&blockReason==='provider_access_limited'\)\{/, 'a limited site hands back too')
assert.match(command, /await resolveSignupCredential\(begun,'handback'\)/, 'the generated password is saved to the Vault on handback')
assert.match(flow, /if \(begun\.committed\) return 'saved'/, 'an already-saved password is not saved twice')
assert.match(flow, /const committed = await findCommittedSignupForRun\(/, 'a resume after handback reuses the saved password')
assert.match(flow, /const existingId = await findVaultCredentialIdByLabel\(/, 'a second attempt for the same email replaces its entry instead of failing on a label conflict')
assert.match(src, /browserSubmitted=runActionLog\.some\(a=>a\?\.kind==='submit'&&a\?\.status==='done'\)/, 'whether anything was submitted comes from the action log')
assert.match(src, /BROWSER_SIGNUP_STOPPED:/, 'a stopped sign-up is logged with step kinds and statuses only')

// Viewing: only passwords Gogo generated, only to the signed-in owner, same-origin, audited, no-store.
const reveal = readFileSync('app/api/dashboard/vault/reveal/route.ts', 'utf8')
assert.match(reveal, /verifySameOrigin\(request\)/)
assert.match(reveal, /getSession\(\)/)
assert.match(reveal, /'cache-control':'no-store/)
assert.match(store, /if\(data\.metadata_json\?\.source!=='secure_browser_signup'\)\{[\s\S]*?throw new Error\('vault_reveal_not_allowed'\)/, 'typed passwords are never shown')
assert.match(store, /eventType:'credential_revealed'/, 'every reveal is audited')
assert.doesNotMatch(store.slice(store.indexOf('export async function revealGeneratedVaultSecret')), /console\.[a-z]+\([^\n]*secret\b/, 'the password is never logged')

console.log('Sign-up handback: reason, submit state, details, link and Vault entry checks passed')
