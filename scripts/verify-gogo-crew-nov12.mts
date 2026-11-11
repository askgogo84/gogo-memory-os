// 12 Nov 2026: the Gogo crew (approved mock). Characters, moods, owner-only switch, saved choice, and that the
// original Gogo drawing is unchanged when the crew is off.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const crew = await import('../lib/gogo/crew.ts')
const { GOGO_AGENT_STATES } = await import('../lib/gogo/agent-states.ts')
const { COMPANIONS, companionFor } = await import('../lib/gogo/characters.ts')
const { Crewmate } = await import('../components/gogo/crewmate.tsx')
const { Companion, CompanionProvider, PoseCompanion } = await import('../components/gogo/companion.tsx')

// Every action state has a mood; the five moods are the only outputs.
const moods = new Set(['idle', 'thinking', 'done', 'needs', 'sleep'])
for (const s of GOGO_AGENT_STATES) assert.ok(moods.has(crew.moodForState(s)), s)
assert.equal(crew.moodForState('approval'), 'needs'); assert.equal(crew.moodForState('failed'), 'thinking', 'never a scary face'); assert.equal(crew.moodForState('watcher'), 'sleep')
assert.equal(crew.moodForPose('calm'), 'idle'); assert.equal(crew.moodForPose('done'), 'done'); assert.equal(crew.moodForPose('approval'), 'needs')

// Registry: six characters, each drawing every state; unknown choices fall back to Gogo.
assert.deepEqual([...crew.CREW_IDS], ['gogo', 'mishti', 'chai', 'tara', 'bolt', 'momo'])
for (const id of crew.CREW_IDS) { assert.equal(COMPANIONS[id].states.length, GOGO_AGENT_STATES.length, id); assert.equal(companionFor(id).id, id) }
assert.equal(companionFor('dragon').id, 'gogo'); assert.equal(companionFor(null).id, 'gogo')
assert.equal(crew.isCrewId('tara'), true); assert.equal(crew.isCrewId('TARA'), false)

// Owner-only switch.
assert.equal(crew.crewEnabledFor('-884501501', { GOGO_CREW: '-884501501' }), true)
assert.equal(crew.crewEnabledFor('123', { GOGO_CREW: '-884501501' }), false)
assert.equal(crew.crewEnabledFor('123', {}), false)

// Every character renders in every mood, with unique ids per instance and no crash on the server.
for (const id of crew.CREW_IDS) for (const m of moods) {
  const html = renderToStaticMarkup(React.createElement(Crewmate, { kind: id, mood: m as any, size: 80 }))
  assert.match(html, /<svg/); assert.match(html, new RegExp(`aria-label="${crew.CREW_LOOKS[id].name}, ${m}"`))
}
const two = renderToStaticMarkup(React.createElement('div', null, React.createElement(Crewmate, { kind: 'gogo' }), React.createElement(Crewmate, { kind: 'gogo' })))
const ids = [...two.matchAll(/id="(body-[^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, 2, 'gradient ids unique per instance')
assert.match(renderToStaticMarkup(React.createElement(Crewmate, { kind: 'chai', label: '' })), /aria-hidden="true"/)
assert.doesNotMatch(renderToStaticMarkup(React.createElement(Crewmate, { kind: 'chai', size: 40 })), /feTurbulence/, 'no fur filter on tiny avatars')

// Off = the original drawings, unchanged; on = the chosen crewmate.
const off = renderToStaticMarkup(React.createElement(CompanionProvider, { choice: 'tara', crew: false }, React.createElement(Companion, { state: 'idle', size: 48 })))
assert.match(off, /Gogo — /); assert.doesNotMatch(off, /Tara/)
const on = renderToStaticMarkup(React.createElement(CompanionProvider, { choice: 'tara', crew: true }, React.createElement(Companion, { state: 'approval', size: 48 })))
assert.match(on, /aria-label="Tara"/)
const poseOn = renderToStaticMarkup(React.createElement(CompanionProvider, { choice: 'momo', crew: true }, React.createElement(PoseCompanion, { state: 'done', size: 40 })))
assert.match(poseOn, /M93\.5 100 l4 4/, 'done mood shows the tick')
const poseOff = renderToStaticMarkup(React.createElement(CompanionProvider, { choice: 'momo', crew: false }, React.createElement(PoseCompanion, { state: 'calm', size: 40 })))
assert.match(poseOff, /Gogo — calm/)

// Wiring and storage.
const layout = readFileSync('app/dashboard/(app)/layout.tsx', 'utf8')
assert.match(layout, /<CompanionProvider choice=\{companion\} crew=\{crew\}>/)
const route = readFileSync('app/api/dashboard/experience/route.ts', 'utf8')
assert.ok(route.indexOf("'companion' in body") < route.indexOf('PERSONALITIES.has(personality)'), 'companion saves on its own')
assert.match(route, /if \(!isCrewId\(body\.companion\)\) return NextResponse\.json\(\{ error: 'invalid_preference' \}, \{ status: 400 \}\)/)
assert.match(readFileSync('lib/dashboard/companion-choice.ts', 'utf8'), /if \(error\) return null/, 'missing column = no choice, never an error')
const sql = readFileSync('supabase/migrations/20261112090000_user_experience_companion.sql', 'utf8')
assert.match(sql, /check \(companion is null or companion in \('gogo','mishti','chai','tara','bolt','momo'\)\)/)
assert.match(readFileSync('supabase/migrations/20261112090000_user_experience_companion.rollback.sql', 'utf8'), /drop column if exists companion/)
// Motion rules from the reference: no touch tracking, reduced motion respected, one shared loop.
const cm = readFileSync('components/gogo/crewmate.tsx', 'utf8')
assert.match(cm, /e\.pointerType !== 'touch'/); assert.match(cm, /prefers-reduced-motion: reduce/); assert.match(cm, /dead = 0\.022 \* vw, full = 0\.162 \* vw/)
assert.equal((cm.match(/addEventListener\('pointermove'/g) || []).length, 1)
console.log('PASS gogo crew: characters, moods, switch, storage, motion rules')
