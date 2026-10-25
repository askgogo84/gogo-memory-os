/**
 * G4 / Bug B — agent_watchers schema drift (cadence_minutes floor + type allow-list).
 *
 * Proves, by measuring values from source (never copying an expected value into
 * the check), that two same-class drifts on agent_watchers are real and resolved
 * by the relax migration:
 *
 * cadence_minutes:
 *   - codeFloor = min Math.max(<floor>, ...) in lib/agent/watchers.ts
 *   - oldBound  = CHECK bound in supabase/agent-os-v1.sql
 *   - newBound  = CHECK bound in the migration
 *   assert codeFloor >= newBound (new admits it) and, as NEGATIVE CONTROL,
 *   codeFloor < oldBound (old would have rejected it -> drift was real).
 *
 * type:
 *   - codeTypes = every literal `type: '...'` at an agent_watchers .insert() site
 *   - oldTypes  = the `type in (...)` list in supabase/agent-os-v1.sql
 *   - newTypes  = the `type in (...)` list in the migration
 *   assert every codeType is in newTypes, and, as NEGATIVE CONTROL, at least one
 *   of web_search / product_stock was NOT in oldTypes (old would have rejected it).
 *
 * Also asserts the migration is name-safe (discovers constraints via pg_constraint
 * by column, not an assumed name) and idempotent. Prints CADENCE_SCHEMA_OK only
 * after every assertion passes.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.cwd()
const fail = (m: string): never => {
  console.error('CADENCE_SCHEMA_FAIL: ' + m)
  process.exit(1)
}
const quoted = (s: string): string[] => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

// --- sources -----------------------------------------------------------------
const watchersSrc = readFileSync(join(repo, 'lib/agent/watchers.ts'), 'utf8')
const baseDdl = readFileSync(join(repo, 'supabase/agent-os-v1.sql'), 'utf8')
const migDir = join(repo, 'supabase/migrations')
const migFile = readdirSync(migDir).find((f) => /relax_agent_watcher_cadence_floor\.sql$/.test(f))
if (!migFile) fail('relax_agent_watcher_cadence_floor migration not found')
const migration = readFileSync(join(migDir, migFile!), 'utf8')
const lower = migration.toLowerCase()

// Scope all base-DDL measurements to the agent_watchers CREATE TABLE block, so a
// `type in (...)` / `check` on a DIFFERENT table (e.g. agent_goals) can never be
// mistaken for this table's constraint.
const awBlockM = baseDdl.match(/create\s+table[^;(]*\bagent_watchers\b\s*\(([\s\S]*?)\n\s*\);/i)
if (!awBlockM) fail('could not isolate the agent_watchers CREATE TABLE block in agent-os-v1.sql')
const awBlock = awBlockM![1]
if (!/\btype\b/.test(awBlock) || !/\bcadence_minutes\b/.test(awBlock)) {
  fail('isolated agent_watchers block is missing type/cadence_minutes columns — anchor is wrong')
}

// --- cadence: measure --------------------------------------------------------
const floors = [...watchersSrc.matchAll(/cadenceMinutes\s*=\s*Math\.max\(\s*(\d+)\s*,/g)].map((m) => Number(m[1]))
if (floors.length === 0) fail('found no cadence Math.max(<floor>, ...) clamps in watchers.ts')
const codeFloor = Math.min(...floors)

const oldBoundM = awBlock.match(/cadence_minutes[^\n]*check\s*\(\s*cadence_minutes\s*>=\s*(\d+)\s*\)/i)
if (!oldBoundM) fail('could not find cadence_minutes CHECK bound in the agent_watchers block')
const oldBound = Number(oldBoundM![1])

const newBoundM = migration.match(/add\s+constraint[^;]*check\s*\(\s*cadence_minutes\s*>=\s*(\d+)\s*\)/i)
if (!newBoundM) fail('migration does not ADD a cadence_minutes CHECK constraint')
const newBound = Number(newBoundM![1])

// --- type: measure -----------------------------------------------------------
const insertSegs = watchersSrc.split(/\.from\(\s*['"]agent_watchers['"]\s*\)\s*\.insert\(/)
const codeTypes = new Set<string>()
for (let i = 1; i < insertSegs.length; i++) {
  const m = insertSegs[i].match(/type\s*:\s*['"]([a-z_]+)['"]/)
  if (m) codeTypes.add(m[1])
}
if (codeTypes.size === 0) fail('found no literal type at any agent_watchers .insert() site')

const oldTypesM = awBlock.match(/\btype\b\s+text[^\n]*check\s*\(\s*type\s+in\s*\(([^)]*)\)/i)
if (!oldTypesM) fail('could not find the type IN (...) CHECK in the agent_watchers block')
const oldTypes = new Set(quoted(oldTypesM![1]))

const newTypesM = migration.match(/check\s*\(\s*type\s+in\s*\(([\s\S]*?)\)\s*\)/i)
if (!newTypesM) fail('migration does not ADD a type IN (...) CHECK constraint')
const newTypes = new Set(quoted(newTypesM![1]))

// --- name-safety + idempotency ----------------------------------------------
if (!lower.includes('pg_constraint')) fail('migration not name-safe: must discover constraints via pg_constraint')
if (!lower.includes('conkey')) fail('migration not name-safe: must discover by column (conkey), not assumed name')
if ((lower.match(/drop constraint/g) || []).length < 2) fail('migration must drop both the cadence and type constraints')
if ((lower.match(/if not exists/g) || []).length < 2) fail('both re-adds must be guarded (idempotent)')

// --- assertions: cadence -----------------------------------------------------
if (codeFloor !== 15) fail(`expected code floor 15 (measured ${codeFloor})`)
if (oldBound !== 60) fail(`expected old DDL bound 60 (measured ${oldBound})`)
if (newBound !== 15) fail(`expected new migration bound 15 (measured ${newBound})`)
if (!(codeFloor >= newBound)) fail(`new cadence constraint rejects code floor: ${codeFloor} < ${newBound}`)
if (!(codeFloor < oldBound)) fail(`cadence negative control failed: old ${oldBound} would not reject ${codeFloor}`)

// --- assertions: type --------------------------------------------------------
// Anchor sanity: the agent_watchers legacy list must contain 'deadline' (its one
// type that overlaps the code). If we accidentally read another table's enum,
// this fails instead of letting the negative control pass for the wrong reason.
if (!oldTypes.has('deadline')) fail(`wrong source: agent_watchers legacy type list lacks 'deadline' — measured {${[...oldTypes].sort().join(',')}}`)
const missing = [...codeTypes].filter((t) => !newTypes.has(t))
if (missing.length) fail(`new type constraint omits code-emitted type(s): ${missing.join(', ')}`)
const oldRejects = ['web_search', 'product_stock'].filter((t) => !oldTypes.has(t))
if (oldRejects.length === 0) fail('type negative control failed: old constraint already admitted both web_search and product_stock, so there was no drift')

// --- report ------------------------------------------------------------------
console.log(`cadence: code floor=${codeFloor} | old=${oldBound} | new=${newBound} (old would reject ${codeFloor}; new admits it)`)
console.log(`type: code emits {${[...codeTypes].sort().join(',')}}`)
console.log(`type: old allowed {${[...oldTypes].sort().join(',')}}`)
console.log(`type: new allows {${[...newTypes].sort().join(',')}} (all code types admitted)`)
console.log(`type negative control: old rejected {${oldRejects.join(',')}}`)
console.log(`migration: ${migFile} (name-safe via pg_constraint/conkey, idempotent)`)
console.log('CADENCE_SCHEMA_OK')
