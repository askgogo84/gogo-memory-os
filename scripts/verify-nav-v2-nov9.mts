// Nav v2 (9 Nov): off by default; the You group covers every old More tab's destination so nothing is lost.
import assert from 'node:assert/strict'
import { navV2EnabledFor } from '../lib/spaces/sources-live'
import { MORE, YOU_V2, NAV } from '../components/dashboard/dashboard-nav'
assert.equal(navV2EnabledFor('-884501501', {}), false)
assert.equal(navV2EnabledFor('-884501501', { GOGO_NAV_V2_OWNERS: '-884501501' }), true)
assert.equal(navV2EnabledFor('5', { GOGO_NAV_V2: '1' }), true)
assert.deepEqual(NAV.map(i => i.label), ['Chat', 'Tasks', 'Make'])
const covered = new Set([...YOU_V2.map(i => i.href.split('?')[0]), '/dashboard/make', '/dashboard/spaces', '/dashboard/tasks', '/dashboard/calendar', '/dashboard/lists', '/dashboard/agent', '/dashboard/business'])
for (const m of MORE) assert.ok(covered.has(m.href.split('?')[0]), `old tab ${m.label} (${m.href}) has a home in v2`)
console.log('verify-nav-v2-nov9: 5 passed')
