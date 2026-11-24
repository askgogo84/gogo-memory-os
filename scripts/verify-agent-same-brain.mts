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

// Replay the dashboard mail search through the real bounded Workspace reader entry.
{
  const exports: any = {}
  const searches: string[] = []
  const actor = { userId: 'user-fixture', legacyTelegramId: 123 }
  let readingAllowed = true
  const dependencies: Record<string, unknown> = {
    './email-format': {
      formatEmailDateIST: (value: string) => value,
      cleanEmailSnippet: (value: string) => value,
      wantsSingleLatestEmail: () => false,
    },
    './typed-object-context': { rememberTypedObjects: async () => {} },
    '@/lib/bot/memory-redaction': { redactSecretShapedText: (value: string) => value },
    '@/lib/email/attention-store': { buildAttentionCard: async () => ({ text: 'Unrelated digest' }) },
    '@/lib/bot/handlers/followup-state': { clearFollowupState: async () => {}, saveFollowupState: async () => {} },
    './google-workspace-read': {
      searchWorkspaceEmails: async (receivedActor: typeof actor, query: string, options: { includeMailbox?: boolean }) => {
        assert.equal(receivedActor, actor)
        searches.push(query)
        if (!readingAllowed) throw new Error('workspace_email_reading_disabled')
        if (query.endsWith(' update')) return { messages: [] }
        return { messages: [{ id: 'msg', threadId: '1ab234cd567ef890', mailbox: options.includeMailbox ? 'second@example.test' : undefined, from: 'Fixture vendor', date: '13 Nov 2026', subject: 'Developer onboarding', snippet: 'Fixture evidence' }] }
      },
    },
  }
  const code = ts.transpileModule(sameBrain, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, console, require: (name: string) => dependencies[name] || {} })
  const explicit = 'Search my Gmail for the Swiggy MCP developer onboarding update.'
  const reply = await exports.tryExplicitGmailSearch(actor, explicit + ' Give the sender organization, date and a short status, plus a link to the source thread. Read only. Do not send or create a draft.')
  const exactQuery = 'Search my Gmail the Swiggy MCP developer onboarding update'
  assert.deepEqual(searches, [exactQuery, exactQuery.replace(/ update$/, '')])
  assert.match(reply, /From: Fixture vendor\nReceived: 13 Nov 2026/)
  assert.match(reply, /https:\/\/mail\.google\.com\/mail\/u\/\?authuser=second%40example\.test#all\/1ab234cd567ef890/)
  const alternative = 'Find emails from Swiggy about MCP developer onboarding.'
  assert.match(await exports.tryExplicitGmailSearch(actor, alternative + ' Show the date and sender. Do not send anything.'), /Fixture evidence/)
  assert.equal(searches.at(-1), alternative.slice(0, -1))
  const inbox = 'Search my inbox for Swiggy MCP developer onboarding'
  assert.match(await exports.tryExplicitGmailSearch(actor, inbox), /Fixture evidence/)
  assert.equal(searches.at(-1), 'Search my inbox Swiggy MCP developer onboarding', 'the targeted inbox query omits its routing preposition')
  const inline = await exports.tryExplicitGmailSearch(actor, 'Search my Gmail for invoices and include a link to the source thread')
  assert.match(inline, /authuser=second%40example\.test/)
  assert.equal(searches.at(-1), 'Search my Gmail invoices')
  await exports.tryExplicitGmailSearch(actor, 'Search my Gmail for "trade show, include session" and read only')
  assert.equal(searches.at(-1), 'Search my Gmail "trade show, include session"')
  assert.match(await exports.tryExplicitGmailSearch(actor, 'Find e-mails about invoices'), /Fixture evidence/)
  assert.equal(searches.at(-1), 'Find emails about invoices')
  for (const query of [
    explicit + ' Then send it to Ravi.',
    explicit + ' Give the sender and forward the thread.',
    'Search my Gmail for invoices and remind me tomorrow to pay them',
    'Search my Gmail for invoices and then, please add a reminder to pay them',
    'Search my Gmail for interviews and schedule the matching interview',
    'Connect my Gmail',
    'Find a Swiggy restaurant',
  ]) {
    assert.equal(await exports.tryExplicitGmailSearch(actor, query), null, query)
  }
  assert.equal(searches.length, 7, 'mixed actions never enter the private search handler')
  readingAllowed = false
  assert.match(await exports.tryExplicitGmailSearch(actor, explicit), /reading is disabled/)
  assert.equal(searches.length, 8, 'a consent error never retries the read')
  const dashboard = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
  assert.ok(dashboard.indexOf('m.tryExplicitGmailSearch(actor, text)') > dashboard.indexOf('await resolveAgentActor('))
  assert.ok(dashboard.indexOf('m.tryExplicitGmailSearch(actor, text)') < dashboard.indexOf('await tryAccountSiteAnswer(actor, text)'))
  assert.match(dashboard, /return NextResponse\.json\(\{ text: mail, handledBy: 'explicit-gmail-search' \}\)/)
}

// The actual Workspace adapter binds mailbox metadata to the credentials used for that read.
{
  const exports: any = {}
  const dependencies: Record<string, unknown> = {
    '@/lib/security/email-redaction': { formatEmailSnippet: (value: string) => value, decodeHtmlEntities: (value: string) => value },
    '@/lib/security/google-token-crypto': { decryptGoogleToken: (value: string) => value, hasGoogleTokenEncryptionKey: () => false },
    '@/lib/bot/memory-redaction': { redactSecretShapedText: (value: string) => value },
    '@/lib/supabase-admin': { supabaseAdmin: {
      from(table: string) {
        assert.ok(table === 'users' || table === 'user_consent_settings')
        return {
          select() { return this },
          eq(key: string, owner: number) { assert.equal(key, 'telegram_id'); assert.equal(owner, 123); return this },
          async maybeSingle() {
            return { data: table === 'users'
              ? { gmail_connected: true, gmail_access_token: 'fixture-account', gmail_email: 'Second@Example.Test' }
              : { gmail_enabled: true } }
          },
        }
      },
    } },
  }
  const code = ts.transpileModule(workspace, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    exports, console, URL, URLSearchParams, require: (name: string) => dependencies[name] || {},
    fetch: async (url: string, init: RequestInit) => {
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-account')
      const endpoint = new URL(url)
      const path = endpoint.pathname
      assert.match(path, /^\/gmail\/v1\/users\/me\/messages(?:\/fixture-entry)?$/)
      if (!path.endsWith('/fixture-entry')) assert.equal(endpoint.searchParams.get('q'), 'demo readiness newer_than:2y')
      return { ok: true, status: 200, json: async () => path.endsWith('/fixture-entry')
        ? { id: 'fixture-entry', threadId: '1ab234cd567ef890', payload: { headers: [] } }
        : { messages: [{ id: 'fixture-entry' }] } }
    },
  })
  const actor = { userId: 'user-fixture', legacyTelegramId: 123 }
  const withLink = await exports.searchWorkspaceEmails(actor, 'Search my Gmail demo readiness', { includeMailbox: true })
  assert.equal(withLink.messages[0].mailbox, 'second@example.test')
  const normal = await exports.searchWorkspaceEmails(actor, 'Search my Gmail demo readiness')
  assert.equal(Object.hasOwn(normal.messages[0], 'mailbox'), false)
}


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
