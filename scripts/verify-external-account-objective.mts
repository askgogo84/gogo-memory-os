import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyAgentRequest } from '../lib/agent/classifier.ts'
import { parseExternalAccountRequest } from '../lib/agent/external-account.ts'
import { findVaultProviderInText } from '../lib/vault/providers.ts'

const exact=parseExternalAccountRequest('Login to huggingface and create a account for me..')
assert.ok(exact,'Hugging Face screenshot request must be claimed as an external-account objective')
assert.equal(exact!.service.toLowerCase(),'huggingface')
assert.equal(exact!.email,null)

const withEmail=parseExternalAccountRequest('Create an account on Hugging Face using goverdhan.md@example.com')
assert.ok(withEmail)
assert.equal(withEmail!.service,'Hugging Face')
assert.equal(withEmail!.email,'goverdhan.md@example.com')

assert.equal(parseExternalAccountRequest('Show me my Hugging Face account'),null,'read-only account questions must not become account creation')
assert.equal(parseExternalAccountRequest('Buy a paid Hugging Face subscription for me'),null,'paid actions stay outside account-creation flow')
assert.equal(parseExternalAccountRequest('Register me for the conference'),null,'event registration must not be stolen by account creation')
assert.equal(parseExternalAccountRequest('Sign up for the yoga class'),null,'class signup must not be stolen by account creation')

const hf=findVaultProviderInText('Hugging Face')
assert.ok(hf,'Hugging Face must resolve through the trusted provider registry')
assert.equal(hf!.domains[0],'huggingface.co')
assert.equal(hf!.signupUrl,'https://huggingface.co/join','account creation must start on the signup form, not the homepage')
assert.equal(findVaultProviderInText('Instagram')!.signupUrl,undefined,'recognized providers without verified signup URLs must not silently fall back to login')

// Automatic consequential-domain discovery by fuzzy search must not exist.
const external=fs.readFileSync('lib/agent/external-account.ts','utf8')
assert.match(external,/looksLikeSignupUrl/,'user-supplied URLs for account creation must be actual signup-form paths')
assert.doesNotMatch(external,/searchWeb\(/,'consequential target discovery must not depend on fuzzy web search')
assert.doesNotMatch(external,/resolveOfficialCandidateFromSearchText/,'name-similarity domain selection is forbidden')
assert.match(external,/findVaultProviderInText/,'known providers must use trusted registry metadata')
assert.match(external,/pendingStillBound/,'follow-up email/url must stay bound to the prompting turn')
assert.match(external,/clearFollowupState/,'unrelated turns must invalidate stale account follow-up state')

const classified=classifyAgentRequest('Create an account on Hugging Face')
assert.equal(classified.capability,'browser')
assert.equal(classified.mode,'execute')
assert.equal(classified.risk,'high')
assert.equal(classified.approvalAction,'submit_form')
const conference=classifyAgentRequest('Register me for the conference')
assert.notEqual(conference.capability==='browser'&&conference.approvalAction==='submit_form',true,'shared classifier must not turn event registration into account creation')

const route=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const routeExternalPos=route.indexOf('parseExternalAccountRequest(text)')
const featurePos=route.indexOf('const featureReply =')
const processPos=route.indexOf('processIncomingMessage({ channel:')
assert.ok(routeExternalPos>=0&&featurePos>=0&&routeExternalPos<featurePos,'external-account objective must beat legacy feature routing')
assert.ok(routeExternalPos>=0&&processPos>=0&&routeExternalPos<processPos,'external-account objective must beat free-form process-message')
assert.match(route,/Runtime capability, not model prose/)

const bridge=fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const externalPos=bridge.indexOf('tryRunExternalAccountFlow({ actor')
const genericBrowserPos=bridge.indexOf('tryRunBrowserCommand({ actor')
assert.ok(externalPos>=0&&genericBrowserPos>=0&&externalPos<genericBrowserPos,'external-account objective must run before generic browser routing')

const browser=fs.readFileSync('lib/agent/browser-command.ts','utf8')
assert.match(browser,/export async function runBrowserCommand/,'constructed objective commands must use the same secure browser policy/run pipeline')
assert.match(browser,/approvalAction/,'external account creation must retain approval binding')
const secure=fs.readFileSync('lib/agent/secure-computer.ts','utf8')
assert.match(secure,/account_creation/,'secure browser must have an explicit account-creation operation')
assert.match(secure,/accountState/,'sandbox confirmation snapshots must retain account-created evidence')
assert.match(secure,/keepAliveOwner/,'approved account handoffs must be able to resume the same retained browser owner/page')
const browserCommand=fs.readFileSync('lib/agent/browser-command.ts','utf8')
assert.match(browserCommand,/persistentAccountSession=accountCreation/,'first approved account execution must already use the task-scoped retained browser owner')
const postAuth=fs.readFileSync('lib/agent/post-auth-outcome.ts','utf8')
assert.match(postAuth,/accountConfirmed/,'post-auth account completion must be context-filtered')
assert.match(postAuth,/if\|when\|once\|after\|before\|until\|unless/,'conditional account-created copy must not count as success')
assert.match(secure,/account\\s+.*created|created.*account/,'account creation must require grounded provider completion evidence')
assert.match(external,/originText:String\(params\.text\)\.trim\(\)/,'accepted email turn must rebind the next URL-stage follow-up')

console.log('✅ Core v1 external-account objective/Vault/browser routing regressions passed')
