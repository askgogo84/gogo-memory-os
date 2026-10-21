// The Gogo character system on the dashboard: each action shows its own state, live lines never over-claim, and
// the shared live view groups and counts the same way Home does.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stateForRun, topicState, stateForHandoff, liveLineFor, overallState, GOGO_AGENT_STATES, GOGO_STATE_LINE } from '../lib/gogo/agent-states.ts'

assert.equal(GOGO_AGENT_STATES.length, 15, 'all 15 designed states')
const run = (status: string, title: string, extra: any = {}) => stateForRun({ status, title, ...extra })
assert.equal(run('running', 'Flights Bangalore to Delhi on Friday'), 'flight')
assert.equal(run('running', 'Tatkal seats to Mysuru'), 'train')
assert.equal(run('running', 'Build my Instamart cart'), 'grocery')
assert.equal(run('running', 'Compare iPhone 16 256GB prices'), 'comparing')
assert.equal(run('running', 'Book a table at Toit on Zomato'), 'booking', 'a table on Zomato is a booking, not groceries')
assert.equal(run('running', 'Reserve at District 6'), 'booking')
assert.equal(run('running', 'Look up the news on Tesla'), 'searching')
assert.equal(run('running', 'Open the site', { type: 'secure_browser' }), 'browsing')
assert.equal(run('running', 'Something else'), 'thinking')
assert.equal(run('waiting_approval', 'Book a table'), 'approval')
assert.equal(run('completed', 'Book a table'), 'done')
assert.equal(run('failed', 'Flights'), 'failed')
assert.equal(run('paused', 'Swiggy', { error: 'secondary_auth: enter the code sent to your phone' }), 'otp')
assert.equal(run('paused', 'Instamart', { error: 'human_auth_required: sign in' }), 'blocked')
assert.equal(stateForHandoff({ title: 'playo.co', summary: 'Robot check — take control' }), 'blocked')
assert.equal(stateForHandoff({ title: 'Swiggy', summary: 'OTP sent to your phone' }), 'otp')
assert.equal(topicState('Check IndiGo fares'), 'flight')
// "done" never claims a booking — only that the task finished.
assert.equal(GOGO_STATE_LINE.done, 'Finished')
assert.doesNotMatch(Object.values(GOGO_STATE_LINE).join(' '), /booked/i)
assert.equal(liveLineFor('comparing', 'Croma, 3 of 5 stores done'), 'Croma, 3 of 5 stores done')
assert.equal(liveLineFor('approval', 'some long summary'), GOGO_STATE_LINE.approval, 'approval keeps its own line')
assert.equal(overallState({ working: [], approvals: 1, handoffs: 0, watchers: 3 }), 'approval')
assert.equal(overallState({ working: [], approvals: 0, handoffs: 0, watchers: 2 }), 'watcher')
assert.equal(overallState({ working: [], approvals: 0, handoffs: 0, watchers: 0 }), 'idle')

// The component carries all 15 states and drops the floating props below 90 px, like the design.
const comp = readFileSync('components/gogo/gogo-agent.tsx', 'utf8')
for (const s of GOGO_AGENT_STATES) assert.ok(new RegExp(`\\b${s}:`).test(comp), `component defines ${s}`)
assert.match(comp, /size < 90/)
assert.match(comp, /animate === undefined && size < 90/, 'small list Gogos are still so long lists stay smooth on phones')
const css = readFileSync('app/globals.css', 'utf8')
assert.match(css, /\.gg-still, \.gg-still \* \{ animation: none !important/)
for (const k of ['gg-breath', 'gg-blink', 'gg-ring', 'gg-plane', 'gg-check']) assert.ok(css.includes(`@keyframes ${k}`), `keyframe ${k}`)

// Navigation: three main places plus Settings; old sections live under More.
const nav = readFileSync('components/dashboard/dashboard-nav.tsx', 'utf8')
const main = nav.slice(nav.indexOf('export const NAV'), nav.indexOf('export const MORE'))
assert.equal((main.match(/label:'/g) || []).length, 3, 'Home, Tasks, Memory')
assert.match(nav, /export const MORE/)

// The old meditating figure is not used for status on the new shell.
for (const f of ['components/dashboard/side-rail.tsx', 'components/dashboard/mobile-nav.tsx', 'components/dashboard/gogo-panel.tsx', 'app/dashboard/(app)/home/page.tsx'])
  assert.doesNotMatch(readFileSync(f, 'utf8'), /gogo-figure|GogoCharacter\b/, `${f} uses the designed Gogo`)
console.log('Gogo agent states: 15 states, action mapping, honest live lines, nav and shell checks passed')
