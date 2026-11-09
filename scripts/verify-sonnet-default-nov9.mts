// 9 Nov (owner-approved): Sonnet default is claude-sonnet-5-5; the env switch rolls it back; the default is priced so
// spend stays metered; no call site hardcodes another Sonnet id.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
const idWith = (env: Record<string, string>) => execSync(`npx tsx -e "import('./lib/services/model-ids.ts').then(m=>process.stdout.write(String(m.SONNET_MODEL ?? m.default?.SONNET_MODEL)))"`, { env: { ...process.env, GOGO_MODEL_SONNET: '', ...env } }).toString()
assert.equal(idWith({}), 'claude-sonnet-5-5')
assert.equal(idWith({ GOGO_MODEL_SONNET: 'claude-sonnet-4-5' }), 'claude-sonnet-4-5', 'GOGO_MODEL_SONNET rolls back without a code change')
const b = await import('../lib/agent/brain')
for (const id of ['claude-sonnet-5-5', 'claude-sonnet-4-5']) assert.ok(b.MODEL_PRICES[id], `${id} priced`)
assert.equal(b.estimateCostUsd('claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 } as any), 2)
const literals = execSync("git grep -nE \"'claude-sonnet-[0-9]\" -- lib app ':!lib/services/model-ids.ts' ':!lib/agent/brain.ts' ':!lib/services/pdf-reader.ts' || true").toString().trim()
assert.equal(literals, '', `hardcoded Sonnet ids outside model-ids/brain prices/pdf fallback:\n${literals}`)
console.log('verify-sonnet-default-nov9: 1 passed')
