import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyAgentRequest } from '../lib/agent/classifier.ts'
import { parseExternalAccountRequest, resolveOfficialCandidateFromSearchText } from '../lib/agent/external-account.ts'

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

const official=resolveOfficialCandidateFromSearchText('Hugging Face',`
1. Hugging Face – The AI community building the future.
Source: https://huggingface.co/
2. Wikipedia
Source: https://en.wikipedia.org/wiki/Hugging_Face
`)
assert.equal(official,'https://huggingface.co/','official-domain discovery must reject aggregator/wiki result')

const classified=classifyAgentRequest('Create an account on Hugging Face')
assert.equal(classified.capability,'browser')
assert.equal(classified.mode,'execute')
assert.equal(classified.risk,'high')
assert.equal(classified.approvalAction,'submit_form')

const bridge=fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const externalPos=bridge.indexOf('tryRunExternalAccountFlow({ actor')
const genericBrowserPos=bridge.indexOf('tryRunBrowserCommand({ actor')
assert.ok(externalPos>=0&&genericBrowserPos>=0&&externalPos<genericBrowserPos,'external-account objective must run before generic browser routing')
assert.match(bridge,/model cannot invent "no browser access"/)

const browser=fs.readFileSync('lib/agent/browser-command.ts','utf8')
assert.match(browser,/export async function runBrowserCommand/,'constructed objective commands must use the same secure browser policy/run pipeline')
assert.match(browser,/approvalAction/,'external account creation must retain approval binding')

console.log('✅ Core v1 external-account objective/Vault/browser routing regressions passed')
