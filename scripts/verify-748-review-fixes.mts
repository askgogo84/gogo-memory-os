// Release review of #743–748 (22 Oct): fixes found by the independent review stay fixed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder'
process.env.OPENAI_API_KEY ||= 'ci-placeholder'
process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder'
const { driveExactNameQ } = await import('../lib/agent/google-workspace-read.ts')
const { missionContradictsTravelStep } = await import('../lib/agent/persistent-travel-read.ts')

// Drive content reads use an exact-title query, escaped, instead of the broad fullText OR search.
assert.equal(driveExactNameQ('Q3 Budget Plan'), "trashed = false and name = 'Q3 Budget Plan'")
assert.equal(driveExactNameQ("Divya's notes"), "trashed = false and name = 'Divya\\'s notes'")
assert.match(readFileSync('lib/agent/persistent-drive-read.ts', 'utf8'), /contentRead\?\{exactName:quotes\[0\]\}:\{\}/)
// An empty Drive result without a `files` key is zero files, not an invalid response.
assert.match(readFileSync('lib/agent/google-workspace-read.ts', 'utf8'), /data\.files !== undefined && !Array\.isArray\(data\.files\)/)

// The person's own constraints win over the planner's step text.
const step = { startDate: '2026-10-30', adults: 1 }
assert.equal(missionContradictsTravelStep('Find flights BLR to DEL on 30 October for 2 adults and a child and remind me to pack', step), true, 'child dropped')
assert.equal(missionContradictsTravelStep('Search flights BLR to DEL on 30 October, back on 2 November, and add a packing list', step), true, 'return dropped')
assert.equal(missionContradictsTravelStep('Find flights from Bangalore to Delhi on 30 October for three people and remind me to pack', step), true, 'adult count differs')
assert.equal(missionContradictsTravelStep('Find flights from Bangalore to Delhi on 30 October 2026 and remind me to pack', step), false, 'matching one-way adult search proceeds')
assert.equal(missionContradictsTravelStep('', step), false)

// Task reuse cannot match through ilike wildcards ("Pay 50% advance" must not reuse "Pay 50 later advance").
assert.match(readFileSync('lib/agent/general-planner.ts', 'utf8'), /\.ilike\('text', text\.replace\(\/\[\\\\%_\]\/g/)
// Mixed flight + reminder plans still confirm the other steps.
assert.match(readFileSync('lib/agent/persistent-general-plan.ts', 'utf8'), /others && run\.summary/)
console.log('748 review fixes: Drive exact title, travel mission constraints, task wildcard escape, mixed-plan reply passed')
