// Nav v2 (9 Nov; on by default since the owner approved it, 17 Nov); the You group covers every old More tab's destination so nothing is lost.
import assert from 'node:assert/strict'
import { navV2EnabledFor } from '../lib/spaces/sources-live'
import { MORE, YOU_V2, NAV } from '../components/dashboard/dashboard-nav'
assert.equal(navV2EnabledFor('-884501501', {}), true, 'on by default')
assert.equal(navV2EnabledFor('5', { GOGO_NAV_V2: '1' }), true)
for (const off of ['off', 'OFF', '0', ' off ']) assert.equal(navV2EnabledFor('5', { GOGO_NAV_V2: off }), false, `"${off}" switches it off`)
assert.equal(navV2EnabledFor('-884501501', { GOGO_NAV_V2: 'off', GOGO_NAV_V2_OWNERS: '-884501501' }), true, 'off for everyone, still on for a listed person')
assert.equal(navV2EnabledFor('5', { GOGO_NAV_V2: 'off', GOGO_NAV_V2_OWNERS: '-884501501' }), false)
assert.deepEqual(NAV.map(i => i.label), ['Chat', 'Tasks', 'Make'])
for (const off of ['false', 'no']) assert.equal(navV2EnabledFor('5', { GOGO_NAV_V2: off }), false, off)
// Review (PR #1528): every old More tab must have a real entry in the v2 menu (or be one of the three tabs). No
// hard-coded exceptions: a page with no menu entry is a page people cannot reach.
const homes = new Set([...YOU_V2, ...NAV].map(i => i.href.split('?')[0]))
for (const m of MORE) assert.ok(homes.has(m.href.split('?')[0]), `old tab ${m.label} (${m.href}) has a menu entry in v2`)
const navSrc = (await import('node:fs')).readFileSync('components/dashboard/dashboard-nav.tsx', 'utf8')
assert.ok(navSrc.includes('v2 ? (spaces ? [SPACES_ITEM, ...YOU_V2] : YOU_V2)'), 'Spaces keeps its entry under v2 for people who have Spaces')
assert.ok((await import('node:fs')).readFileSync('components/dashboard/mobile-nav.tsx', 'utf8').includes('[...NAV, SPACES_ITEM, ...YOU_V2, ...MORE, SETTINGS]'), 'phone top bar uses the v2 names')
console.log('verify-nav-v2-nov9: all passed')
