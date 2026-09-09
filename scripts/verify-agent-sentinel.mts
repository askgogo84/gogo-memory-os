import assert from 'node:assert/strict'
import { evaluateAgentSentinel } from '../lib/agent/sentinel'

assert.deepEqual(evaluateAgentSentinel({capability:'browser',mode:'read',risk:'low',irreversible:false,approved:false,url:'https://example.com',instruction:'read this page'}),{allowed:true,reason:'sentinel_clear'})
assert.equal(evaluateAgentSentinel({capability:'browser',mode:'read',risk:'low',irreversible:false,approved:false,url:'http://localhost:3000',instruction:'read'}).allowed,false)
assert.equal(evaluateAgentSentinel({capability:'browser',mode:'read',risk:'low',irreversible:false,approved:false,url:'http://192.168.1.10',instruction:'read'}).allowed,false)
assert.equal(evaluateAgentSentinel({capability:'browser',mode:'execute',risk:'high',irreversible:true,approved:false,url:'https://example.com',instruction:'submit the form'}).allowed,false)
assert.deepEqual(evaluateAgentSentinel({capability:'browser',mode:'execute',risk:'high',irreversible:true,approved:true,url:'https://example.com',instruction:'submit the form'}),{allowed:true,reason:'sentinel_clear'})
assert.equal(evaluateAgentSentinel({capability:'memory',mode:'read',risk:'low',irreversible:false,approved:false,instruction:'show password: hunter2'}).allowed,false)
assert.equal(evaluateAgentSentinel({capability:'browser',mode:'draft',risk:'medium',irreversible:false,approved:false,instruction:'fill this form',actionCount:31}).allowed,false)
console.log('agent sentinel verification passed')
