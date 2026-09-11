import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/dashboard/(app)/home/page.tsx', import.meta.url), 'utf8')
const rail = readFileSync(new URL('../components/dashboard/side-rail.tsx', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('../components/dashboard/tab-bar.tsx', import.meta.url), 'utf8')

assert.match(home, /Your mind,/, 'dashboard home must carry the approved website promise')
assert.match(home, /text-gogo-teal/, 'dashboard home must use the final teal primary treatment')
assert.match(home, /approval/, 'dashboard must keep approval state visible')
assert.match(home, /Consequential actions still stop at your approval/, 'dashboard must retain the user-control boundary')
assert.match(home, /Background Gogo is working/, 'dashboard must surface background work without changing execution semantics')
assert.match(rail, /Your mind, lighter\./, 'desktop rail must match the final AskGogo design language')
assert.match(rail, /bg-gogo-teal text-white/, 'desktop active navigation must use the final teal primary')
assert.match(tabs, /text-gogo-teal/, 'mobile active navigation must use the final teal primary')
assert.match(tabs, /bg-gogo-teal/, 'mobile active indicator must use the final teal primary')
assert.doesNotMatch(home, /tone=\"plum\"/, 'home must not fall back to the old multi-colour portal treatment')

console.log('✅ dashboard website-parity design regression passed')
