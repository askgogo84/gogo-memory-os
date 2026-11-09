import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const sameBrain=readFileSync(new URL('../lib/agent/same-brain.ts',import.meta.url),'utf8')
const workspace=readFileSync(new URL('../lib/agent/google-workspace-read.ts',import.meta.url),'utf8')
const legacy=readFileSync(new URL('../lib/feature-intents-legacy.ts',import.meta.url),'utf8')

assert.match(sameBrain,/feature-intents-legacy/)
assert.doesNotMatch(sameBrain,/from ['"]@\/lib\/feature-intents['"]/)
assert.match(sameBrain,/routeLegacyFeatureIntent/)
assert.match(sameBrain,/processIncomingMessage/)
assert.match(legacy,/\/api\/todos/)
assert.match(legacy,/addToListDetailed/)
assert.match(legacy,/remind|reminder/i)

// Connected Workspace reads are deterministic and happen before the legacy/LLM
// path. The token stays inside the server-side helper; only bounded/redacted
// results come back to the planner step.
assert.match(sameBrain,/tryWorkspaceRead/)
assert.match(sameBrain,/searchWorkspaceEmails/)
assert.match(sameBrain,/searchWorkspaceContacts/)
assert.match(sameBrain,/searchWorkspaceDrive/)
assert.ok(sameBrain.indexOf('tryWorkspaceRead(params.actor,text)') < sameBrain.indexOf('routeLegacyFeatureIntent(params.actor.whatsappId'))
assert.match(sameBrain,/I won't guess which person you mean/)
assert.match(sameBrain,/I did not guess or fall back to another account/)

assert.match(workspace,/gmail_access_token,gmail_refresh_token/)
assert.match(workspace,/response\.status === 401/)
assert.match(workspace,/workspace_scope_required/)
assert.match(workspace,/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/)
assert.match(workspace,/people\.googleapis\.com\/v1\/people:searchContacts/)
assert.match(workspace,/www\.googleapis\.com\/drive\/v3\/files/)
assert.match(workspace,/MAX_FILE_TEXT = 60_000/)
assert.match(workspace,/redactSecretShapedText/)
assert.doesNotMatch(workspace,/console\.log\([^\n]*(?:gmail_access_token|refreshToken|Authorization)/)

// "Use the attached brief" must read the actual bounded attachment, never use a
// Gmail snippet as a substitute. Supported office/PDF/text formats are extracted
// server-side; multiple equally plausible attachments pause rather than guess.
assert.match(workspace,/MAX_ATTACHMENT_BYTES = 8 \* 1024 \* 1024/)
assert.match(workspace,/format=full/)
assert.match(workspace,/\/attachments\//)
assert.match(workspace,/readWorkspaceEmailBrief/)
assert.match(workspace,/extractServerlessPdfText\(bytes,MAX_FILE_TEXT\)/,'Workspace PDF must use shared guarded parser')
const serverlessPdf=readFileSync('lib/services/pdf-js-serverless.ts','utf8')
assert.match(serverlessPdf,/ensurePdfJsServerlessGlobals\(\)\s*\n\s*const mod:any=await import\('pdf-parse'\)/,'PDF.js globals must be initialized before module import')
assert.match(workspace,/jszip/)
assert.match(workspace,/xlsx/)
assert.match(workspace,/status:'ambiguous'/)
assert.match(sameBrain,/readWorkspaceEmailBrief/)
assert.match(sameBrain,/no readable attachment matched the brief request/)
assert.match(sameBrain,/I won't guess which brief you mean/)
assert.match(sameBrain,/I did not substitute the email snippet for the document/)

console.log('✅ Agent planner dispatch uses bounded Workspace reads + real Gmail attachment briefs')


// P1 agent actor regression: exercise the REAL transpiled owner resolver with an
// inert, strict PostgREST fixture. No network, sessions, provider calls or writes.
const actorRows: any[] = [
  { id: 'safe-123', telegram_id: '123', whatsapp_id: 'whatsapp:+919999999001', name: 'Owner 123', timezone: 'Asia/Kolkata' },
  { id: 'safe-456', telegram_id: '456', whatsapp_id: 'whatsapp:+919999999002', name: 'Owner 456', timezone: 'UTC' },
  { id: 'group', telegram_id: '-1001234567890', whatsapp_id: 'whatsapp:+919999999003', name: 'Group' },
  { id: 'rounded-2p53', telegram_id: '9007199254740992', whatsapp_id: 'whatsapp:+919999999004', name: 'BIGINT A' },
  { id: 'distinct-2p53', telegram_id: '9007199254740993', whatsapp_id: 'whatsapp:+919999999005', name: 'BIGINT B' },
]
const actorLookups: {table:string;clauses:[string,unknown][]}[] = []
let ownerReadOutage = false
const fakeActorDb = {
  from(table: string) {
    const clauses: [string,unknown][] = []
    const query: any = {
      select() { return query },
      eq(key: string, value: unknown) { clauses.push([key,value]); return query },
      async maybeSingle() {
        actorLookups.push({table,clauses:[...clauses]})
        if (table === 'users') {
          if (ownerReadOutage) return {data:null,error:{message:'fixture owner store unavailable'}}
          const row = actorRows.find(u => clauses.every(([key,value]) => String(u[key]) === String(value)))
          return {data:row||null,error:null}
        }
        if (table === 'wa_creditiq_links') {
          const sender = clauses.find(([key]) => key === 'sender')?.[1]
          return {data:sender === 'whatsapp:+919999999001' ? {consumer_user_id:'ciq-user-123'} : null,error:null}
        }
        throw Error('Unexpected provider/table: '+table)
      }
    }
    return query
  },
}
const realActorExports: any = {}
const actorCode = ts.transpileModule(readFileSync('lib/agent/actor.ts','utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
runInNewContext(actorCode, {
  exports: realActorExports, module:{exports:realActorExports}, console,
  require(name: string) {
    if (name === '@/lib/supabase-admin') return {supabaseAdmin:fakeActorDb}
    throw Error('Unexpected actor dependency: '+name)
  },
})
const actorSession = (telegramId: string, userId?: string) =>
  ({telegramId,userId,surface:userId?'ios':'web'} as const)
const goodActor = await realActorExports.resolveAgentActor(actorSession('123'))
assert.equal(goodActor.userId,'safe-123')
assert.equal(goodActor.legacyTelegramId,123)
assert.equal(goodActor.creditiqUserId,'ciq-user-123','existing best-effort link still works')
assert.ok(actorLookups.some(x => x.table === 'users' && x.clauses.some(([k,v])=>k==='telegram_id' && v==='123')), 'owner selector is the exact string, not an imprecise JS Number')
assert.equal((await realActorExports.resolveAgentActor(actorSession('-1001234567890'))).legacyTelegramId,-1001234567890, 'safe negative legacy group IDs remain supported')
assert.equal((await realActorExports.resolveAgentActor(actorSession('456','safe-456'))).userId,'safe-456','mobile UUID path still resolves correct owner')

for (const bad of ['','0','+123','000123','123.0','1e3','Infinity','NaN','9007199254740992','9007199254740993','-9007199254740993','9223372036854775807']) {
  const before=actorLookups.length
  await assert.rejects(realActorExports.resolveAgentActor(actorSession(bad)),/agent_actor_invalid_session_owner/,bad)
  assert.equal(actorLookups.length,before,'invalid/rounded actor ID caused zero service-role queries: '+bad)
}
let prev=actorLookups.length
await assert.rejects(realActorExports.resolveAgentActor(actorSession('123','safe-456')),/agent_actor_identity_mismatch/,'mobile UUID and authenticated telegram owner must agree')
assert.equal(actorLookups.filter(x=>x.table==='wa_creditiq_links').length,3,'mismatched identity never reads cross-owner CreditIQ link')
await assert.rejects(realActorExports.resolveAgentActor(actorSession('123','rounded-2p53')),/legacy_identity_unsafe/,'unsafe persisted BIGINT row refused before downstream agent actions')
ownerReadOutage=true
await assert.rejects(realActorExports.resolveAgentActor(actorSession('456')),/agent_actor_lookup_failed/,'owner lookup outage never falls back to a guessed account')
ownerReadOutage=false
await assert.rejects(realActorExports.resolveAgentActor(actorSession('789')),/agent_actor_not_found/,'missing owner never falls back')
assert.ok(actorLookups.length>prev)
console.log('Agent actor owner precision: exact safe identity, distinct BIGINT denial, UUID cross-owner refusal and DB outage fail closed')
