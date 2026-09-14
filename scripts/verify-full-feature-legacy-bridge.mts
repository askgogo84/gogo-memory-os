import assert from 'node:assert/strict'
import fs from 'node:fs'

const legacy = fs.readFileSync('lib/feature-intents-legacy.ts', 'utf8')
const sameBrain = fs.readFileSync('lib/agent/same-brain.ts', 'utf8')

// Mature deterministic personal-life features must stay reachable before the
// open-ended agent planner. This is what lets native mobile use the same brain
// without reimplementing expenses, splits, nutrition, contacts, lists or todos.
assert.match(legacy, /parseSplitIntent/)
assert.match(legacy, /\/api\/splitbill/)
assert.match(legacy, /\/api\/expenses/)
assert.match(legacy, /handleNutritionText/)
assert.match(legacy, /isNutritionLogText/)
assert.match(legacy, /CONTACT MEMORY/)
assert.match(legacy, /\/api\/todos/)
assert.match(legacy, /addToListDetailed/)
assert.match(legacy, /buildNaturalAssetRetrievalReply/)
assert.match(legacy, /skin-reminder/)
assert.match(legacy, /DAILY BRIEFING/)

assert.match(sameBrain, /routeLegacyFeatureIntent/)
assert.match(sameBrain, /processIncomingMessage/)
assert.ok(
  sameBrain.indexOf('routeLegacyFeatureIntent') < sameBrain.lastIndexOf('processIncomingMessage'),
  'deterministic feature router must remain ahead of open-ended Same Brain fallback',
)

console.log('✅ Mature expenses/splits/nutrition/contacts/lists/tasks remain bridged into Same Brain')
