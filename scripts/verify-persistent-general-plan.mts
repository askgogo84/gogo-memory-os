import assert from 'node:assert/strict'
import fs from 'node:fs'

const persistent=fs.readFileSync('lib/agent/persistent-general-plan.ts','utf8')
const route=fs.readFileSync('app/api/agent/run/route.ts','utf8')
const cron=fs.readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'))

assert.match(persistent,/prepareGeneralPlan/)
assert.match(persistent,/recordTaskModelUsage\(params.actor.legacyTelegramId,created.runId,modelUsage\)/)
assert.match(persistent,/createAutonomousRun/)
assert.match(persistent,/executeAutonomousRun/)
assert.match(persistent,/recoverStaleAutonomousSteps/)
assert.match(persistent,/resumePersistentGeneralPlan/)
assert.match(persistent,/executeVerifiedMissionMemory/)
assert.match(persistent,/executeVerifiedMissionList/)
assert.match(persistent,/executeVerifiedMissionReminder/)
assert.match(persistent,/executeVerifiedMissionWebSearch/)
assert.match(persistent,/verificationRequired:\s*true/)
assert.match(persistent,/persistent_general_plan:\s*true/)
assert.match(persistent,/maxAttempts:\s*4/)
assert.match(persistent,/drivePersistentRun/)

assert.match(route,/tryRunPersistentGeneralPlan/)
assert.ok(route.indexOf('tryRunPersistentGeneralPlan') < route.indexOf('tryRunGeneralPlan({'),'persistent runtime must be attempted before legacy general planner')
assert.match(route,/persistentPlan/)

assert.match(cron,/CRON_SECRET/)
assert.match(cron,/resumePersistentGeneralPlan/)
assert.match(cron,/\.eq\('type','autonomous'\)/)
assert.match(cron,/\.in\('status',\['running','queued'\]\)/)

const autonomousCron=vercel.crons.find((item:any)=>item.path==='/api/cron/autonomous-runs')
assert.ok(autonomousCron,'persistent autonomous cron must be scheduled')
assert.equal(autonomousCron.schedule,'* * * * *')

console.log('✅ Persistent general-plan routing + resume worker regression passed')

const autonomous=fs.readFileSync('lib/agent/autonomous-runtime.ts','utf8')
assert.doesNotMatch(autonomous,/Gogo created a persistent execution plan and started working on it/,'run summaries shown to users must not narrate orchestration')
assert.doesNotMatch(persistent,/Gogo created a persistent plan and started executing it/,'persistent-plan fallback copy must stay outcome-first')
assert.match(autonomous,/I’m working through this request/)
assert.match(autonomous,/Completed and verified/)
console.log('Outcome-first persistent mission summary verification passed')


// Cron actor source-isolation regression (P1 conditional). Exercise the ACTUAL
// local resolver only with an inert table adapter; no cron, real DB, provider,
// browser, Vault, notifications, bookings or payment side effects.
const { runInNewContext } = await import('node:vm')
const ts = await import('typescript')
const actorStart = cron.indexOf('async function actorFor(')
const actorEnd = cron.indexOf('\nexport async function GET(', actorStart)
assert.ok(actorStart >= 0 && actorEnd > actorStart, 'background cron actor resolver boundaries must remain present')
const actorSource = cron.slice(actorStart, actorEnd).replace('async function actorFor(', 'export async function actorFor(')
const compiledActor = ts.transpileModule(actorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type ActorFixtureRow = { id: string; telegram_id: unknown; whatsapp_id?: string; name?: string }
async function resolveSyntheticCronActor(askedOwner: string | number, row: ActorFixtureRow | null) {
  const queries: Array<{ table: string; key: string; value: unknown }> = []
  const q: any = {
    select: (_columns: string) => q,
    eq: (key: string, value: unknown) => {
      queries.push({ table: 'users', key, value })
      return q
    },
    maybeSingle: async () => ({ data: row, error: null }),
  }
  const mockedDb = { from: (table: string) => {
    assert.equal(table, 'users', 'actor resolution must only use the inert users table')
    return q
  } }
  const exported: any = {}
  runInNewContext(compiledActor, {
    exports: exported,
    supabaseAdmin: mockedDb,
    console: { error: () => undefined },
    Number,
    String,
  })
  return { actor: await exported.actorFor(askedOwner), queries }
}
const actorA: ActorFixtureRow = {
  id: 'synthetic-user-a', telegram_id: '9007199254740992',
  whatsapp_id: 'whatsapp:+15550000001', name: 'Synthetic A',
}
const ownerB = await resolveSyntheticCronActor('9007199254740993', actorA)
assert.equal(ownerB.actor, null, 'an adjacent 64-bit owner must never obtain another user row as actor')
assert.equal(ownerB.queries.length, 0, 'reject unsafe owner BEFORE querying private identities')
const alreadyRounded = await resolveSyntheticCronActor(9007199254740992, actorA)
assert.equal(alreadyRounded.actor, null, 'reject already-rounded numeric input before private reads')
assert.equal(alreadyRounded.queries.length, 0)
for (const malformed of ['0042', '42.0', '4e1', '+42', 'not-a-user', '0']) {
  const result = await resolveSyntheticCronActor(malformed, {
    id: 'synthetic', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042',
  })
  assert.equal(result.actor, null, 'ambiguous owner id must fail closed: ' + malformed)
  assert.equal(result.queries.length, 0, 'malformed owner triggered a users read: ' + malformed)
}
const goodOwner = await resolveSyntheticCronActor('42', {
  id: 'synthetic-good', telegram_id: 42, whatsapp_id: 'whatsapp:+15550000042', name: 'Synthetic Good',
})
assert.equal(goodOwner.actor?.userId, 'synthetic-good')
assert.equal(goodOwner.actor?.legacyTelegramId, 42)
assert.equal(goodOwner.actor?.whatsappId, 'whatsapp:+15550000042')
assert.deepEqual(goodOwner.queries, [{ table: 'users', key: 'telegram_id', value: '42' }],
  'must send precise decimal text, not an unverified Number conversion, to SQL')
const otherRow = await resolveSyntheticCronActor('42', {
  id: 'synthetic-other', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000043',
})
assert.equal(otherRow.actor, null, 'a different persisted users row cannot authorize the queued owner')
const unsafeReturned = await resolveSyntheticCronActor('42', {
  id: 'synthetic-rounded', telegram_id: 9007199254740992, whatsapp_id: 'whatsapp:+15550000043',
})
assert.equal(unsafeReturned.actor, null, 'DB clients that already rounded a returned owner must be rejected')
const negative = await resolveSyntheticCronActor('-42', {
  id: 'synthetic-negative', telegram_id: '-42', whatsapp_id: 'whatsapp:+15550000042',
})
assert.equal(negative.actor?.legacyTelegramId, -42, 'existing safe negative WhatsApp owners must continue')
assert.deepEqual(negative.queries, [{ table: 'users', key: 'telegram_id', value: '-42' }])
console.log('Cron actor source-isolation regression passed (unsafe/mismatched owners blocked, valid actors preserved)')
