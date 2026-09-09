import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const capture=readFileSync(new URL('../lib/agent/native-capture.ts',import.meta.url),'utf8')
const route=readFileSync(new URL('../app/api/agent/capture/route.ts',import.meta.url),'utf8')
const device=readFileSync(new URL('../app/api/agent/devices/route.ts',import.meta.url),'utf8')
const push=readFileSync(new URL('../lib/agent/push.ts',import.meta.url),'utf8')

assert.match(route,/requireAgentSession/)
assert.match(route,/resolveAgentActor/)
assert.match(route,/24\*1024\*1024/)
assert.match(route,/request\.formData\(\)/)
assert.match(capture,/const BUCKET='user-documents'/)
assert.match(capture,/gpt-4o-mini-transcribe/)
assert.match(capture,/claude-sonnet-4-5/)
assert.match(capture,/\.from\('documents'\)\.insert/)
assert.match(capture,/source:'native_app'/)
assert.match(capture,/content:`\$\{analysis\.title\}\\n\$\{analysis\.summary\}`/)
assert.doesNotMatch(capture,/indexMemory\([^)]*extractedText/s)
assert.match(capture,/never passwords, OTPs, CVVs, PINs or API keys/i)

assert.match(device,/requireAgentSession/)
assert.match(device,/session\.surface==='web'/)
assert.match(device,/agent_devices/)
assert.match(push,/exp\.host\/--\/api\/v2\/push\/send/)
assert.match(push,/DeviceNotRegistered/)

console.log('agent native capture and push verification passed')
