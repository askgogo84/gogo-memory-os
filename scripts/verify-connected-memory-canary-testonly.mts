/**
 * TEST ONLY / EXPECT RED on deployed 29-Oct-2026 #1079.
 *
 * Read the REAL TypeScript route AST, evaluate only the connected-memory gate
 * expressions in an inert VM with synthetic actors and configuration.
 * Never execute route bodies, Supabase, providers, reminders or sends.
 * Claude owns source corrections; do not merge this evidence-only draft.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Surface = { name: string; path: string; marker: string; conditionMeansAllowed: boolean }
const surfaces: Surface[] = [
  {name: 'whatsapp-text',path:'app/api/webhooks/whatsapp/route.ts',marker:'tryLifeGraphTurn',conditionMeansAllowed:true},
  {name: 'whatsapp-image',path:'app/api/webhooks/whatsapp/route.ts',marker:'return false',conditionMeansAllowed:false},
  {name: 'dashboard-web',path:'app/api/dashboard/chat/route.ts',marker:'tryLifeGraphTurn',conditionMeansAllowed:true},
]
function connectedMemoryGuard(surface: Surface): string {
  const file = readFileSync(surface.path,'utf8')
  const parsed = ts.createSourceFile(surface.path,file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
  const guards: string[] = []
  function visit(node: ts.Node): void {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(parsed)
      const thenText = node.thenStatement.getText(parsed)
      if (condition.includes('GOGO_MEMORY') && condition.includes('VERCEL_ENV') && thenText.includes(surface.marker)) {
        guards.push(condition)
      }
    }
    ts.forEachChild(node,visit)
  }
  visit(parsed)
  assert.equal(guards.length,1,surface.name+': locate exactly one source gate, not a stale fixture stub')
  return guards[0]
}

const listedActor = '+15550001111' // inert, non-customer example
const otherActor = '+15550002222' // inert, non-customer example
const cases = [
  {name:'listed production canary',env:{GOGO_MEMORY:'on',GOGO_BRAIN_USERS:listedActor,VERCEL_ENV:'production'},actor:listedActor,expected:true},
  {name:'production noncanary',env:{GOGO_MEMORY:'on',GOGO_BRAIN_USERS:listedActor,VERCEL_ENV:'production'},actor:otherActor,expected:false},
  {name:'production default-list outsider',env:{GOGO_MEMORY:'on',VERCEL_ENV:'production'},actor:otherActor,expected:false},
  {name:'preview explicitly listed noncanary',env:{GOGO_MEMORY:'on',GOGO_BRAIN_USERS:listedActor,VERCEL_ENV:'preview'},actor:otherActor,expected:false},
  {name:'memory flag OFF',env:{GOGO_MEMORY:'off',GOGO_BRAIN_USERS:listedActor,VERCEL_ENV:'production'},actor:listedActor,expected:false},
] as const
const failures: string[] = []
for (const surface of surfaces) {
  const expression = connectedMemoryGuard(surface)
  const compiled = ts.transpileModule('Boolean('+expression+');',{
    compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022},
  }).outputText
  for (const item of cases) {
    const canary = (input:unknown) => String(input || '').replace(/\D/g,'')===listedActor.replace(/\D/g,'')
    const sandbox = {
      env:item.env,process:{env:item.env},preserveFriendFlow:false,
      from:item.actor,phone:item.actor,whatsappTo:item.actor,
      resolvedUser:{whatsappId:item.actor,telegramId:123},
      user:{whatsapp_id:item.actor,telegram_id:123},
      brainEnabledFor:canary,memoryEnabledFor:canary,
    }
    try {
      const tested = Boolean(runInNewContext(compiled,sandbox,{timeout:1000}))
      const allowed = surface.conditionMeansAllowed ? tested : !tested
      assert.equal(allowed,item.expected,'owner not in configured canary must not enter connected-memory ingestion')
      console.log('PASS '+surface.name+' / '+item.name)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failures.push(surface.name+' / '+item.name+': '+error)
    }
  }
}
if (failures.length) {
  for (const failure of failures) console.error('FAIL '+failure)
  process.exitCode=1
} else {
  console.log('PASS connected-memory route gates honor per-owner canary on all inert surfaces')
}
