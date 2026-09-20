import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard=fs.readFileSync('app/dashboard/page.tsx','utf8')
const browser=fs.readFileSync('lib/agent/browser-command.ts','utf8')
const connect=fs.readFileSync('lib/vault/connect-link.ts','utf8')
const resume=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/resume/route.ts','utf8')
const form=fs.readFileSync('components/dashboard/vault-credential-form.tsx','utf8')

assert.doesNotMatch(connect,/issueToken|[?&]t=/,'persistable Vault links must not contain dashboard auth credentials')
assert.match(connect,/\/dashboard\/you\/vault\/add\//)
assert.match(connect,/returnRun/)
assert.match(dashboard,/^function postAuthTarget\(\)/m)
assert.match(dashboard,/\/dashboard\\\/you\\\/vault/)
assert.match(browser,/buildVaultAddLink/)
assert.match(browser,/Don't send your password here/)
assert.match(browser,/resumePausedBrowserRun/)
assert.match(resume,/verifySameOrigin\(request\)/)
assert.match(resume,/getSession\(\)/)
assert.match(form,/props\.returnRun/)
assert.match(form,/\/resume/)
assert.doesNotMatch(connect,/password|secret/i,'signed link builder must never receive a password')
assert.doesNotMatch(resume,/secret_ciphertext|username_ciphertext/,'resume endpoint must never read Vault ciphertext')

console.log('Vault handoff + resume contract passed')

const browserPage=fs.readFileSync('app/dashboard/(app)/activity/[runId]/browser/page.tsx','utf8')
assert.match(browserPage,/Secure Vault/)
assert.match(browserPage,/VaultResumeTaskButton/)
assert.match(browserPage,/Add \{vaultProvider\.label\} login/)

assert.match(browser,/browser_resume_permission_blocked/)
assert.match(browser,/permission\(tg\)/)
assert.match(browser,/evaluateAgentExecutionPolicy/)
assert.match(browser,/executeApprovedBrowserCommand\(\{actor:params\.actor,runId:String\(params\.runId\)\}\)/)
assert.match(browser,/eq\('status','approved'\)/)

assert.match(browser,/credentialSelectionRequired/)
assert.match(browser,/accountChoiceUrl/)
assert.match(resume,/credentialId/)
assert.match(resume,/credential_not_allowed/)
assert.match(browserPage,/vaultNeedsSelection/)
assert.match(browserPage,/Use \$\{account\.accountLabel\}/)
