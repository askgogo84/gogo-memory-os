// TEST ONLY / EXPECTED RED until external TypeSafe context redaction is safe.
// Imports the shipped pure Jev request builder. Uses fake marker strings only;
// no DB, model, network, provider credentials, browser, or production accounts.
import { buildJevShadowRequest, keywordSecretTurn, scrubForTypeSafe } from '../lib/typesafe/jev-shadow'

type Case = { name: string; expectSafe: () => boolean }
const cases: Case[] = []
const add = (name: string, expectSafe: () => boolean) => cases.push({ name, expectSafe })
const base = {
  text: 'Please show the team calendar tomorrow',
  currentCapability: 'calendar_read',
  currentActionFamily: 'read',
  needsContext: true,
  focusKind: 'calendar',
}

const build = (recentContext: string | null, focusSummary: string | null = null) =>
  buildJevShadowRequest({ ...base, recentContext, focusSummary })

// Four positive controls: benign context, expected label handling, and direct-turn withholding.
add('CONTROL: benign recent conversation remains available for legitimate context', () =>
  build('We discussed the Friday roadmap').state.context.recent_conversation === 'We discussed the Friday roadmap')
add('CONTROL: email in recent context is masked', () =>
  !String(build('Please email demo.person@example.test').state.context.recent_conversation).includes('demo.person@example.test'))
add('CONTROL: ordinary alphanumeric labelled password is masked', () =>
  !scrubForTypeSafe('password: SyntheticMarker42').includes('SyntheticMarker42'))
add('CONTROL: direct password-labelled user turn is recognized as sensitive', () =>
  keywordSecretTurn('my password: @SyntheticMarker42!'))

// P1 negative regressions: punctuation-leading synthetic password after a label must
// NOT enter the provider-bound payload, even when an unrelated current turn is safe.
// Do not print the marker, the payload, or a candidate value in CI logs.
for (const [label, marker] of [
  ['at-sign', '@SyntheticMarker42!'],
  ['exclamation', '!SyntheticMarker43!'],
  ['hash', '#SyntheticMarker44!'],
] as const) {
  add('SAFETY: punctuation-leading ' + label + ' credential absent from recent conversation', () => {
    const payload = build('user: my password: ' + marker)
    return !JSON.stringify(payload).includes(marker)
  })
}
add('SAFETY: punctuation-leading password absent from focus summary', () => {
  const marker = '@SyntheticMarker45!'
  return !JSON.stringify(build('We discussed the Friday roadmap', 'Our password: ' + marker)).includes(marker)
})
add('SAFETY: punctuation-leading password absent from scrubber output', () => {
  const marker = '@SyntheticMarker46!'
  return !scrubForTypeSafe('user: my password: ' + marker).includes(marker)
})

let failures = 0
let controls = 0
for (const { name, expectSafe } of cases) {
  let passed = false
  try { passed = Boolean(expectSafe()) } catch { passed = false }
  if (passed) { controls++; console.log('PASS ' + name) }
  else { failures++; console.error('FAIL ' + name + ' (synthetic secret would remain in provider-bound context)') }
}
console.log('Jev TypeSafe secret-boundary: ' + controls + ' passed, ' + failures + ' failed; TEST ONLY; no provider requests')
if (failures) process.exitCode = 1
