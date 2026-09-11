import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = p => fs.readFileSync(p, 'utf8')
const character = read('components/gogo/gogo-character.tsx')
const empty = read('components/dashboard/empty-state.tsx')
const loader = read('components/dashboard/float-loader.tsx')
const icon = read('public/askgogo-icon.svg')
const mark = read('public/askgogo-mark.svg')
const logo = read('public/askgogo-logo.svg')

for (const state of ['calm','listening','thinking','remembering','acting','watching','found','approval','secure','done','breathing','sleeping']) {
  assert.ok(character.includes(state), `Gogo state missing: ${state}`)
}
for (const token of ['#F3E7D3','#EF7A27','#2C1A13','#2FAE6A']) assert.ok(character.includes(token), `character palette missing ${token}`)
assert.match(empty, /GogoCharacter state="calm"/)
assert.doesNotMatch(empty, /gogo-figure\.png/)
assert.match(loader, /GogoCharacter state="thinking"/)
assert.doesNotMatch(loader, /gogo-(?:float|figure)\.(?:gif|png)/)
for (const asset of [icon, mark, logo]) {
  assert.match(asset, /#2C1A13/)
  assert.match(asset, /#F3E7D3/)
  assert.match(asset, /#EF7A27/)
  assert.doesNotMatch(asset, /#2AE372|#12B85C/)
}
console.log('Gogo character-system regression: OK')
