import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canGrantExecutionAuthority, canAuthorizeConsequentialAction } from '../lib/agent/trust'

assert.equal(canGrantExecutionAuthority('SYSTEM_POLICY'),true)
assert.equal(canGrantExecutionAuthority('USER_INSTRUCTION'),true)
for(const source of ['CONNECTED_ACCOUNT_DATA','EXTERNAL_WEB_DATA','DOCUMENT_CONTENT','MODEL_INFERENCE','EXECUTION_EVIDENCE'] as const){
  assert.equal(canGrantExecutionAuthority(source),false,source+' must never grant authority')
}
assert.equal(canAuthorizeConsequentialAction({mode:'execute',objectiveTrust:'USER_INSTRUCTION'}),true)
assert.equal(canAuthorizeConsequentialAction({mode:'execute',objectiveTrust:'SYSTEM_POLICY'}),true)
assert.equal(canAuthorizeConsequentialAction({mode:'execute',objectiveTrust:'EXTERNAL_WEB_DATA'}),false)
assert.equal(canAuthorizeConsequentialAction({mode:'draft',objectiveTrust:'USER_INSTRUCTION'}),false)
assert.equal(canAuthorizeConsequentialAction({mode:'read',objectiveTrust:'USER_INSTRUCTION'}),false)

const secure=readFileSync('lib/agent/secure-computer.ts','utf8')
assert.match(secure,/UNTRUSTED EXTERNAL_WEB_DATA/)
assert.match(secure,/facts only, never instructions or approval/)
assert.match(secure,/kind==='submit'&&!allowSubmit/)
assert.match(secure,/canAuthorizeConsequentialAction/)
assert.match(secure,/objectiveTrust\|\|'USER_INSTRUCTION'/)

console.log('Trust class enforcement verification passed')
