import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync('lib/feature-intents.ts','utf8')
const catchStart=source.indexOf("console.error('WHATSAPP_AGENT_BRIDGE_FAILED:'")
assert.ok(catchStart>=0,'bridge failure catch must exist')
const tail=source.slice(catchStart,catchStart+900)
assert.ok(!/return\s+null/.test(tail),'bridge exceptions must never fall through as routing non-matches')
assert.ok(tail.includes('stopped instead of guessing'),'failure reply must state fail-closed behavior')
assert.ok(source.includes('if(agent?.text)return agent.text'))
console.log('agent bridge fail-closed regression passed')
