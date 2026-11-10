// 10 Nov hotfix: Sonnet default is back to claude-sonnet-4-5 (5.5 broke forced tool_choice in the brain); the env switch
// still selects another id; the default is priced so
// spend stays metered; no call site hardcodes another Sonnet id.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
const idWith = (env: Record<string, string>) => execSync(`npx tsx -e "import('./lib/services/model-ids.ts').then(m=>process.stdout.write(String(m.SONNET_MODEL ?? m.default?.SONNET_MODEL)))"`, { env: { ...process.env, GOGO_MODEL_SONNET: '', ...env } }).toString()
assert.equal(idWith({}), 'claude-sonnet-4-5')
assert.equal(idWith({ GOGO_MODEL_SONNET: 'claude-sonnet-5-5' }), 'claude-sonnet-5-5', 'GOGO_MODEL_SONNET selects another id without a code change')
// Sonnet 5.5 rejects forced tool_choice, sampling params and thinking:disabled. Every Sonnet call site must go through
// forModel() (and read text with textOf) before a 5.x id may become the default or be set by env.
const fs = await import('node:fs')
for (const f of ['lib/agent/brain.ts', 'lib/services/claude.ts', 'lib/services/pdf-reader.ts', 'lib/services/asset-memory.ts', 'lib/services/voice-reply.ts', 'lib/agent/deep-research.ts']) {
  const src = fs.readFileSync(f, 'utf8')
  const raw = (src.match(/messages\.create\(\{/g) || []).length
  assert.equal(raw, 0, `${f}: ${raw} messages.create call(s) not wrapped in forModel()`)
  assert.ok(!/content\[0\]/.test(src), `${f}: reads content[0]; use textOf()`)
}
const b = await import('../lib/agent/brain')
for (const id of ['claude-sonnet-5-5', 'claude-sonnet-4-5']) assert.ok(b.MODEL_PRICES[id], `${id} priced`)
assert.equal(b.estimateCostUsd('claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 } as any), 2)
const literals = execSync("git grep -nE \"'claude-sonnet-[0-9]\" -- lib app ':!lib/services/model-ids.ts' ':!lib/agent/brain.ts' ':!lib/services/pdf-reader.ts' || true").toString().trim()
assert.equal(literals, '', `hardcoded Sonnet ids outside model-ids/brain prices/pdf fallback:\n${literals}`)
console.log('verify-sonnet-default-nov9: 1 passed')
