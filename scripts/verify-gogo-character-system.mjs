import fs from 'node:fs'
import path from 'node:path'
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

function sourceFiles(root) {
  if (!fs.existsSync(root)) return []
  const out = []
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(?:tsx?|jsx?)$/.test(name)) out.push(full)
  }
  return out
}

const dashboardSources = [...sourceFiles('app/dashboard'), ...sourceFiles('components/dashboard')]
const legacyRefs = dashboardSources
  .filter(file => /gogo-(?:float\.gif|figure\.png)/.test(read(file)))
  .map(file => file.replaceAll('\\','/'))
assert.deepEqual(legacyRefs, [], `Legacy Gogo image references remain in dashboard: ${legacyRefs.join(', ')}`)

for (const required of [
  'components/dashboard/gogo-chat.tsx',
  'components/dashboard/breathing-space.tsx',
  'components/dashboard/personalize-gogo.tsx',
  'components/dashboard/learn-with-gogo.tsx',
  'app/dashboard/(app)/agent/page.tsx',
  'components/dashboard/mobile-gogo-chat-button.tsx',
]) {
  assert.match(read(required), /GogoCharacter/, `Canonical Gogo missing from ${required}`)
}

console.log('Gogo character-system regression: OK')
