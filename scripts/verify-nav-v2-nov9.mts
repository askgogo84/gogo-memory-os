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
const covered = new Set([...YOU_V2.map(i => i.href.split('?')[0]), '/dashboard/make', '/dashboard/spaces', '/dashboard/tasks', '/dashboard/calendar', '/dashboard/lists', '/dashboard/agent', '/dashboard/business'])
for (const m of MORE) assert.ok(covered.has(m.href.split('?')[0]), `old tab ${m.label} (${m.href}) has a home in v2`)
console.log('verify-nav-v2-nov9: 10 passed')
