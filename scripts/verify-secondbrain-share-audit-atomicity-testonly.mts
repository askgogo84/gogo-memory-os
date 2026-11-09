// Independent, test-only SecondBrain share/audit consistency regression.
// Executes shipped lib/workspaces/access.ts against wholly inert in-memory state.
// No network, customer data, provider calls, workspace migration, or real sharing.
// EXPECTED RED until share/unshare and their required audit evidence are atomic.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as rules from '../lib/workspaces/rules'

const workspace = '11111111-1111-4111-8111-111111111111'
const artifactId = '22222222-2222-4222-8222-222222222222'
const owner = '17'
const viewer = '18'
const otherMember = '19'
const members = new Map<string,string>([[owner,'member'],[viewer,'viewer'],[otherMember,'member']])
type Share = {workspace_id:string;artifact_id:string;shared_by:string}
const shares = new Map<string,Share>()
const auditRows:Array<{workspace_id:string;actor:string;action:string;target:string|null}> = []
let denyAudit = false
let providerCalls = 0
let privateReads = 0

const db = {
  from(table:string) {
    const filters = new Map<string,unknown>()
    let deleting = false
    const q:any = {
      select: () => q,
      eq: (key:string,value:unknown) => { filters.set(key,value); return q },
      maybeSingle: async () => {
        if (table === 'workspace_members') {
          const id = String(filters.get('telegram_id') ?? '')
          const role = String(filters.get('workspace_id')) === workspace ? members.get(id) : null
          return {data: role ? {role} : null,error:null}
        }
        if (table === 'agent_artifacts') {
          privateReads++
          const permitted = String(filters.get('id')) === artifactId && String(filters.get('telegram_id')) === owner
          return {data: permitted ? {id:artifactId,telegram_id:owner,title:'Synthetic report only'} : null,error:null}
        }
        if (table === 'workspace_artifacts') {
          const row = shares.get(String(filters.get('artifact_id')))
          const match = row && row.workspace_id === String(filters.get('workspace_id'))
          return {data:match ? {shared_by:row.shared_by} : null,error:null}
        }
        throw new Error('Unexpected maybeSingle table in synthetic test: ' + table)
      },
      upsert: async (row:Share) => {
        assert.equal(table,'workspace_artifacts')
        assert.equal(row.workspace_id,workspace)
        assert.equal(row.artifact_id,artifactId)
        assert.equal(row.shared_by,owner)
        shares.set(row.artifact_id,{...row})
        return {error:null}
      },
      delete: () => {
        assert.equal(table,'workspace_artifacts')
        deleting = true
        return q
      },
      insert: async (row:any) => {
        assert.equal(table,'workspace_audit_log')
        if (denyAudit) return {error:{code:'P0001',message:'synthetic audit unavailable'}}
        auditRows.push({...row})
        return {error:null}
      },
      then: (resolve:(value:any)=>any,reject:(error:any)=>any) => {
        if (!deleting) throw new Error('Unexpected thenable query: ' + table)
        const id = String(filters.get('artifact_id'))
        const existing = shares.get(id)
        if (existing && existing.workspace_id === String(filters.get('workspace_id'))) shares.delete(id)
        return Promise.resolve({error:null}).then(resolve,reject)
      },
    }
    if (!['workspace_members','agent_artifacts','workspace_artifacts','workspace_audit_log'].includes(table)) {
      throw new Error('Unexpected private or provider table: ' + table)
    }
    return q
  },
}

const actualSource = readFileSync('lib/workspaces/access.ts','utf8')
const compiled = ts.transpileModule(actualSource,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText
const api:any = {}
runInNewContext(compiled,{
  exports:api,
  require:(name:string) => {
    if (name === '@/lib/supabase-admin') return {supabaseAdmin:db}
    if (name === './rules') return rules
    providerCalls++
    throw new Error('Unmocked import forbidden in synthetic regression: ' + name)
  },
  console:{error:()=>{},log:()=>{}},
  Date,
},{filename:'synthetic-secondbrain-access.js',timeout:2000})
assert.equal(typeof api.shareArtifact,'function')
assert.equal(typeof api.unshareArtifact,'function')

const failed:string[] = []
let passed = 0
function reset() {
  shares.clear()
  auditRows.length = 0
  denyAudit = false
  privateReads = 0
  providerCalls = 0
}
async function check(name:string,run:()=>Promise<void>) {
  try {await run();passed++;console.log('PASS:',name)}
  catch(err:any) {
    const reason = name + ': ' + String(err?.message || err)
    failed.push(reason)
    console.error('EXPECTED RED:',reason)
  }
}
function isCode(expected:string) {
  return (error:any) => String(error?.code) === expected
}

await check('own report sharing requires membership and records an audit line',async()=>{
  reset()
  const outcome = await api.shareArtifact(owner,workspace,artifactId)
  assert.equal(outcome.ok,true)
  assert.equal(shares.size,1)
  assert.equal(shares.get(artifactId)?.shared_by,owner)
  assert.equal(auditRows.length,1)
  assert.equal(auditRows[0].action,'artifact.share')
  assert.equal(auditRows[0].actor,owner)
  assert.equal(auditRows[0].workspace_id,workspace)
})

await check('another workspace member cannot share a report they do not own',async()=>{
  reset()
  await assert.rejects(api.shareArtifact(otherMember,workspace,artifactId),isCode('artifact_not_found'))
  assert.equal(shares.size,0)
  assert.equal(auditRows.length,0)
  assert.equal(privateReads,1)
})

await check('viewer lacks permission to share before private artifact reads',async()=>{
  reset()
  await assert.rejects(api.shareArtifact(viewer,workspace,artifactId),isCode('workspace_forbidden'))
  assert.equal(shares.size,0)
  assert.equal(auditRows.length,0)
  assert.equal(privateReads,0)
})

await check('ordinary member unshare removes the report and records an audit line',async()=>{
  reset()
  await api.shareArtifact(owner,workspace,artifactId)
  const outcome = await api.unshareArtifact(owner,workspace,artifactId)
  assert.equal(outcome.ok,true)
  assert.equal(shares.size,0)
  assert.deepEqual(auditRows.map(x=>x.action),['artifact.share','artifact.unshare'])
  assert.equal(auditRows[1].actor,owner)
})

await check('audit-write failure cannot leave an unlogged, visible workspace share',async()=>{
  reset()
  denyAudit = true
  await assert.rejects(api.shareArtifact(owner,workspace,artifactId),isCode('workspace_unavailable'))
  assert.equal(shares.size,0,
    'share upsert succeeded but audit insert failed: personal report remains visible without durable consent/audit evidence')
  assert.equal(auditRows.length,0)
})

await check('audit-write failure cannot revoke an existing share without durable evidence',async()=>{
  reset()
  shares.set(artifactId,{workspace_id:workspace,artifact_id:artifactId,shared_by:owner})
  denyAudit = true
  await assert.rejects(api.unshareArtifact(owner,workspace,artifactId),isCode('workspace_unavailable'))
  assert.equal(shares.size,1,
    'unshare delete succeeded but audit insert failed: access change is misreported and unaudited')
  assert.equal(auditRows.length,0)
})

assert.equal(providerCalls,0,'no providers, other source modules, or customer services may be imported')
console.log('SecondBrain test-only controls passed:',passed,'safety failures:',failed.length)
if (failed.length) {
  console.error(failed.join('\n'))
  process.exitCode = 1
}
