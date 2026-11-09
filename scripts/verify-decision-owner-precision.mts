import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the shipped TypeScript module, not a copied guard. All dependencies
// are inert: no Supabase network, real account, provider, or notification.
const dbCalls: Array<{kind:string;table:string;row?:any}> = []
const ownerPredicates: unknown[] = []
const inserts: any[] = []
let deliveryEvidenceCalls = 0
const fakeDb = {
  from(table:string) {
    dbCalls.push({kind:'from',table})
    assert.equal(table,'agent_activity','unexpected privileged data path')
    const q:any = {
      select: () => q,
      eq: (column:string,value:unknown) => {
        if (column==='telegram_id') ownerPredicates.push(value)
        return q
      },
      order: () => q,
      limit: async () => ({data:[],error:null}),
      insert: async (row:any) => {
        inserts.push(row)
        return {error:null}
      }
    }
    return q
  }
}
const exportsFromRealModule:any = {}
const actualSource = readFileSync(new URL('../lib/agent/decision-learning.ts', import.meta.url),'utf8')
const js = ts.transpileModule(actualSource,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
runInNewContext(js,{
  exports:exportsFromRealModule,
  module:{exports:exportsFromRealModule},
  console,
  require(name:string) {
    if (name==='@/lib/supabase-admin') return {supabaseAdmin:fakeDb}
    if (name==='./delivery-learning') return {hasDeliveryLearningEvidence:async () => {deliveryEvidenceCalls++;return null}}
    if (name==='./execution-evidence') return {hasExecutionEvidence:()=>false}
    if (name==='./decision-evidence') return {finiteConfidence:()=>null,rankEvidence:()=>({preferredHandler:null,avoidHandlers:[],confidence:0})}
    if (name==='@/lib/bot/memory-redaction') return {isSecretShapedMemory:()=>false,redactSecretShapedText:(s:string)=>s}
    if (name==='./brain-introspection') return {isSameBrainIntrospection:()=>false,sameBrainIntrospection:()=>null}
    throw new Error('unexpected dependency: '+name)
  },
})
const learn = (owner:unknown) => exportsFromRealModule.recordDecisionLearning({
  actor:{legacyTelegramId:owner},text:'fictional harmless reminder',domain:'reminders',
  handler:'reminder-delivery',deliveryRef:{kind:'reminder',id:'fixture-only'},
  outcome:'unknown',verified:false,
})
const hint = (owner:unknown) => exportsFromRealModule.decisionHints({
  actor:{legacyTelegramId:owner},text:'fictional harmless reminder',domain:'reminders',
})
const invalidOwners:unknown[]=[
  Number('9007199254740993'), 9007199254740992, -9007199254740992,
  0,-0,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,
  1.5,'+42','042','42.0','1e3','9007199254740992','9007199254740993',null,undefined,{valueOf:()=>42}
]
for (const owner of invalidOwners) {
  const before=dbCalls.length, beforeEvidence=deliveryEvidenceCalls
  await assert.rejects(learn(owner),/decision_learning_owner_invalid/,'learning write must deny ambiguous/malformed actor: '+String(owner))
  await assert.rejects(hint(owner),/decision_learning_owner_invalid/,'private hints must deny ambiguous/malformed actor: '+String(owner))
  assert.equal(dbCalls.length,before,'owner was allowed into private agent_activity: '+String(owner))
  assert.equal(deliveryEvidenceCalls,beforeEvidence,'invalid owner consulted receipt evidence: '+String(owner))
}
for (const owner of [42,-42,Number.MAX_SAFE_INTEGER,'42','-42']) {
  const prior=dbCalls.length
  await learn(owner)
  await hint(owner)
  assert.equal(dbCalls.length,prior+2,'safe signed owner retains read and write')
  assert.equal(inserts.at(-1)?.telegram_id,String(owner),'learning write owner bound exactly')
  assert.equal(ownerPredicates.at(-1),String(owner),'hints query owner bound exactly')
}
assert.equal(dbCalls.filter(c=>c.table!=='agent_activity').length,0)
console.log('PASS Same Brain learning owner: unsafe/malformed IDs denied before receipt/private reads+writes; exact signed safe controls retained')
