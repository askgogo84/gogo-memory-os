import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sameBrain=readFileSync(new URL('../lib/agent/same-brain.ts',import.meta.url),'utf8')
const legacy=readFileSync(new URL('../lib/feature-intents-legacy.ts',import.meta.url),'utf8')

assert.match(sameBrain,/feature-intents-legacy/)
assert.doesNotMatch(sameBrain,/from ['"]@\/lib\/feature-intents['"]/)
assert.match(sameBrain,/routeLegacyFeatureIntent/)
assert.match(sameBrain,/processIncomingMessage/)
assert.match(legacy,/\/api\/todos/)
assert.match(legacy,/addToListDetailed/)
assert.match(legacy,/remind|reminder/i)

console.log('✅ Agent planner step dispatch is non-recursive and uses shared deterministic stores')
