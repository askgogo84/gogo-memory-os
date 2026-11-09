// TEST-ONLY / EXPECTED SAFETY RED — goal review must not resolve another account's actor.
// Executes the ORIGINAL shipped actorForTelegram function from the current main source,
// transpiled in an isolated VM with synthetic owner rows. No network, provider, DB,
// real user, credential, message, watcher, or other external side effect.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const FILE = 'lib/agent/goal-engine.ts'
const original = readFileSync(FILE, 'utf8')
const ast = ts.createSourceFile(FILE, original, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
assert.equal(ast.parseDiagnostics.length, 0, 'shipped goal-engine source must parse')
const functions = ast.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === 'actorForTelegram')
assert.equal(functions.length, 1, 'test exactly one ORIGINAL actorForTelegram function')
const fn = functions[0]
assert.ok(fn.body)
assert.match(original, /const actor=await actorForTelegram\(tg\)/, 'goal-review worker must use this exact resolver')
assert.match(original, /notify\(actor,/, 'original worker must route goal progress to the selected actor')
assert.match(original, /dispatchThroughSameBrain\(\{internalStep:true,actor,/, 'original private actions must use selected actor')
const compiled = ts.transpileModule(fn.getText(ast) + '\nglobalThis.__goalActor = actorForTelegram;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

const A = '9007199254740992'
const B = '9007199254740993'
assert.equal(Number(A), Number(B), 'fixtures must represent distinct BIGINT owners with identical JS Number')
const users = [
  { id:'uuid-small', telegram_id:'42', whatsapp_id:'whatsapp:+15550000042', name:'Small' },
  { id:'uuid-a', telegram_id:A, whatsapp_id:'whatsapp:+15550000001', name:'Owner A' },
  { id:'uuid-b', telegram_id:B, whatsapp_id:'whatsapp:+15550000002', name:'Owner B' },
  { id:'uuid-no-phone', telegram_id:'77', whatsapp_id:null, name:'No phone' },
]
async function resolve(telegramId, opts = {}) {
  const filters = []
  const fake = {
    from(table) {
      assert.equal(table, 'users', 'only the user lookup is permitted in the sealed fixture')
      return {
        select() { return this },
        eq(column, value) { filters.push({column, value}); return this },
        async maybeSingle() {
          if (opts.dbError) return { data:null, error:{code:'fixture_error'} }
          const f = filters.at(-1)
          const data = users.find(row => row.telegram_id === String(f?.value)) ?? null
          return {data, error:null}
        },
      }
    },
  }
  const env = { supabaseAdmin:fake, Number, String, globalThis:{} }
  runInNewContext(compiled, env, { timeout:1000 })
  const actor = await env.globalThis.__goalActor(telegramId)
  return { actor, filters }
}

let controls = 0, safetyPassed = 0, safetyFailed = 0
async function control(label, fn) {
  await fn()
  controls++
  console.log('PASS CONTROL: ' + label)
}
async function safety(label, fn) {
  try { await fn(); safetyPassed++; console.log('PASS SAFETY: ' + label) }
  catch (err) { safetyFailed++; console.error('FAIL SAFETY (expected until source fix): ' + label + ': ' + String(err?.message || err)) }
}

await control('small canonical owner resolves their own UUID and WhatsApp', async () => {
  const r=await resolve('42')
  assert.equal(r.actor?.userId, 'uuid-small')
  assert.equal(r.actor?.whatsappId, 'whatsapp:+15550000042')
})
await control('known owner A resolves their own UUID in synthetic fixture', async () => {
  assert.equal((await resolve(A)).actor?.userId, 'uuid-a')
})
await control('unknown owner returns null, not a guessed recipient', async () => {
  assert.equal((await resolve('12345')).actor, null)
})
await control('database error blocks goal actor selection', async () => {
  assert.equal((await resolve('42', {dbError:true})).actor, null)
})
await control('missing WhatsApp link blocks goal actor selection', async () => {
  assert.equal((await resolve('77')).actor, null)
})

await safety('P1: goal actor lookup binds exact B decimal, never rounded A', async () => {
  assert.equal(String((await resolve(B)).filters[0]?.value), B)
})
await safety('P1: B goal cannot select A user UUID for private action', async () => {
  const actor=(await resolve(B)).actor
  assert.ok(!actor || actor.userId === 'uuid-b', 'B goal selected different account UUID')
})
await safety('P1: B goal cannot select A WhatsApp for review notification', async () => {
  const actor=(await resolve(B)).actor
  assert.ok(!actor || actor.whatsappId === 'whatsapp:+15550000002', 'B goal routes review to A')
})
await safety('P1: distinct goal owners must resolve distinct actor identities or fail closed', async () => {
  const x=(await resolve(A)).actor, y=(await resolve(B)).actor
  assert.ok(!x || !y || x.userId !== y.userId, 'A and B goal watchers alias to one actor')
})
await safety('P1: unsafe numeric owner inputs cannot silently resolve to A', async () => {
  const actor=(await resolve(Number(B))).actor
  assert.equal(actor, null, 'already-rounded unsafe owner number must not select a real account')
})
console.log('RESULT positive_controls='+controls+' safety_pass='+safetyPassed+' safety_fail='+safetyFailed)
assert.equal(controls, 5)
assert.equal(safetyPassed, 5, 'all five goal-review owner/recipient identity gates must pass before merging')
console.log('SECURITY GREEN: goal-review actor and notification identity are exact-owner bound')
