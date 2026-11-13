// 13 Nov 6 pm live: "compare Amul butter 500 g on Instamart, Zepto and Blinkit" — Zepto stopped at a CAPTCHA (never
// bypassed) and was reported as "needs your delivery location or sign-in"; its paused browser task kept the shared
// grocery browser reserved, so Blinkit answered "my browser was busy with another task".
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {providerObservation} from '../lib/commerce/comparison-model.ts'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const child = {id: 'run-z', status: 'paused', error: 'human_auth_required', updated_at: '2026-11-13T12:31:51Z'}
const captcha = providerObservation('zepto', child, {status: 'failed', output_json: {authReason: 'captcha'}}, 'Amul butter 500 g')
ok(captcha.status === 'blocked' && /robot check \(CAPTCHA\)/.test(String(captcha.reason)) && !(captcha as any).needsInput, 'CAPTCHA is named as a robot check, never as location/sign-in')
ok(/don’t try to get past/.test(String(captcha.reason)), 'says plainly Gogo does not get past it')
const loc = providerObservation('blinkit', {...child, error: 'delivery_location_required'}, {status: 'failed', output_json: {authReason: null}}, 'Amul butter 500 g')
ok(loc.status === 'blocked' && /delivery location or sign-in/.test(String(loc.reason)), 'a real location/sign-in stop keeps its wording')
const pc = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
const release = pc.indexOf('releaseRunAuthHandoff(owner, String(row.runId))'), claim = pc.indexOf("const next = task.metadata_json.providers.find(row => row.status === 'pending'")
ok(release > 0 && release < claim, 'a blocked sibling store’s browser hold is released before the next shared-browser store is claimed')
ok(/row\.status === 'blocked' && row\.runId && !PARALLEL_COMPARISON_PROVIDERS\.has\(row\.provider\)/.test(pc), 'only this comparison’s blocked shared-browser stores are released')
ok(/some\(row => row\.status === 'pending' && !PARALLEL_COMPARISON_PROVIDERS\.has\(row\.provider\)\)\) \{\s*const held/.test(pc), 'released only when another shared-browser store is still waiting')
ok(!/captcha/i.test(pc.slice(release - 900, release + 200).replace(/CAPTCHA and its paused|showed a CAPTCHA/gi, '')), 'no CAPTCHA handling or solving in the release path')
console.log(`PASS verify-grocery-shared-browser-nov13: ${checks} checks`)
