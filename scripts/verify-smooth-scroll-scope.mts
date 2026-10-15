// Smooth scrolling must never reach the app surface.
//
// The risk this guards is not "Lenis is broken" — it is "someone adds a route
// to the allowlist, or switches it to a blocklist, and a dashboard table starts
// hijacking the wheel". That is a one-line change in a file nobody reads twice,
// so it gets a test.
//
// Run: npx tsx scripts/verify-smooth-scroll-scope.mts

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isSmoothRoute } from '../components/scroll/smooth-scroll'

const SRC = 'components/scroll/smooth-scroll.tsx'
const src = fs.readFileSync(SRC, 'utf8')

// ── The allowlist must stay an allowlist ─────────────────────────────────────
assert.match(src, /const SMOOTH_ROUTES: ReadonlySet<string>/, 'SMOOTH_ROUTES must remain an explicit set')
assert.doesNotMatch(src, /BLOCK(ED)?_ROUTES|EXCLUDE_ROUTES/, 'a blocklist fails open — keep the allowlist')
console.log('  ✓ route gating is an allowlist, not a blocklist')

// ── Marketing routes in, app routes out ──────────────────────────────────────
assert.equal(isSmoothRoute('/'), true, 'the marketing landing page should be smoothed')
console.log('  ✓ / is smoothed')

const MUST_STAY_NATIVE = [
  // dashboards
  '/dashboard', '/dashboard/home', '/dashboard/today', '/dashboard/usage', '/dashboard/you',
  // chat
  '/dashboard/chat',
  // tables / data views
  '/dashboard/tasks', '/dashboard/lists', '/dashboard/memory', '/dashboard/calendar',
  // agent + admin surfaces
  '/dashboard/agent', '/dashboard/learn', '/dashboard/personalize', '/admin', '/admin/users',
  // payment / booking workflows
  '/pay', '/upgrade', '/pitch', '/pitch-upload',
  // a route that does not exist yet: the allowlist must fail closed
  '/dashboard/reports', '/checkout/step-2',
]
for (const route of MUST_STAY_NATIVE) {
  assert.equal(isSmoothRoute(route), false, `${route} must keep native scrolling`)
}
console.log(`  ✓ ${MUST_STAY_NATIVE.length} app/dashboard/workflow routes keep native scrolling`)

// A prefix entry must never swallow a sibling app route.
assert.equal(isSmoothRoute('/dashboardx'), false)
assert.equal(isSmoothRoute(''), false)
assert.equal(isSmoothRoute(null), false)
assert.equal(isSmoothRoute(undefined), false)
console.log('  ✓ empty, null and near-miss pathnames are not smoothed')

// ── The guard rails themselves ───────────────────────────────────────────────
assert.match(src, /prefers-reduced-motion: reduce/, 'must check prefers-reduced-motion')
assert.match(src, /if \(mq\?\.matches\) return/, 'reduced motion must return BEFORE constructing Lenis')
assert.match(src, /syncTouch: false/, 'touch scrolling must stay native')
assert.match(src, /allowNestedScroll: true/, 'nested scrollers must keep their own scrolling')
assert.match(src, /autoRaf: true/, 'Lenis must own its rAF loop; no second ticker')
assert.match(src, /lenis'\) === 'off'/, 'the ?lenis=off escape hatch must stay')
assert.match(src, /lenis\?\.destroy\(\)/, 'must tear down on unmount and on navigation')
assert.doesNotMatch(src, /requestAnimationFrame/, 'no page-level rAF loop — autoRaf owns it')
assert.match(src, /SCROLLABLE_THRESHOLD_PX/, 'must not construct Lenis on a page with nothing to scroll')
assert.match(src, /scrollable < SCROLLABLE_THRESHOLD_PX\) return/, 'the scrollability check must return BEFORE constructing Lenis')
console.log('  ✓ reduced motion, native touch, nested scroll, single rAF, escape hatch, teardown')
console.log('  ✓ inert on pages with nothing to scroll')

console.log('\n✅ smooth-scroll scope: marketing only, app surface untouched')
