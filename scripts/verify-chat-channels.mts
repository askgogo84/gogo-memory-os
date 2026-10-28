// Duet parity step 4: one ongoing thread plus channels; memory, tasks and approvals stay shared.
// Run: npx tsx scripts/verify-chat-channels.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
// History: a channel shows only its own rows; the main view shows rows outside channels and still works before the migration.
assert.match(route, /export async function GET\(req\?: NextRequest\)/)
assert.match(route, /resolveThreadForUser\(String\(user\.telegram_id\), threadParam\)/, 'a channel must belong to the signed-in owner')
assert.match(route, /if \(scoped && threadId\) q = q\.eq\('thread_id', threadId\)/)
assert.match(route, /data = \(data \|\| \[\]\)\.filter\(\(row: any\) => !row\?\.thread_id\)\.slice\(0, 50\)/)
assert.match(route, /if \(error\) \(\{ data, error \} = await historyQuery\(false\)\)/, 'pre-migration fallback for the main view')
// Send: rows created by this request are tagged, owner-scoped, untagged only, only after a successful reply.
assert.match(route, /export async function POST\(req: NextRequest\) \{ return withChatChannel\(req\) \}\n\nasync function handleChatPost\(req: NextRequest\)/)
assert.match(route, /if \(threadValue && res\.status < 400\)/)
assert.match(route, /\.eq\('telegram_id', tg\)\.is\('thread_id', null\)\.gte\('created_at', startedAt\)/)
assert.match(route, /await import\('@\/lib\/agent\/thread-context'\)/, 'lazy import keeps strict route harnesses working')
assert.equal((route.match(/^import .*thread-context/gm) || []).length, 0, 'no eager import')

// DASHBOARD CHAT EXACT OWNER FIXTURE — invoke deployed helper with an inert, owner-tagged database.
// A session ID is exact TEXT. Never allow bigint rounding or parseInt prefix truncation
// to choose a different user's chat history or WhatsApp recipient.
{
  const start = route.indexOf('async function resolveDashboardUser(telegramId: string)')
  const end = route.indexOf('\nasync function saveConversation(', start)
  assert.ok(start >= 0 && end > start, 'test must use the real dashboard-chat owner resolver')
  const actual = route.slice(start, end)
  const compiled = ts.transpileModule(actual + '\nexports.lookup = resolveDashboardUser',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

  async function inspectOwner(sessionOwner: string, returnedOwner: string | number | null) {
    const reads: { column: string, value: unknown }[] = []
    const fakeDb = {
      from(table: string) {
        assert.equal(table, 'users', 'only the user lookup may be reached')
        return {
          select(columns: string) {
            assert.equal(columns, 'telegram_id, whatsapp_id, name')
            return this
          },
          eq(column: string, value: unknown) {
            reads.push({ column, value })
            return this
          },
          async maybeSingle() {
            return { data: returnedOwner === null ? null : {
              telegram_id: returnedOwner, whatsapp_id: 'whatsapp:+15550000042', name: 'Synthetic fixture'
            }, error: null }
          },
        }
      },
    }
    const exports: any = {}
    runInNewContext(compiled, { exports, supabaseAdmin: fakeDb, Promise, Number, String, parseInt })
    return { row: await exports.lookup(sessionOwner), reads }
  }

  for (const unsafe of ['9007199254740992', '9007199254740993', '4242suffix', '4242e4',
    ' 4242', '90071992547409931234']) {
    const got = await inspectOwner(unsafe, '9007199254740992')
    assert.equal(got.row, null, 'an unsafe session owner must not resolve a foreign user: ' + unsafe)
    assert.equal(got.reads.length, 0, 'an unsafe owner must fail before privileged user lookup: ' + unsafe)
  }
  const valid = await inspectOwner('4242', 4242)
  assert.equal(valid.row?.name, 'Synthetic fixture', 'a valid canonical owner still resolves')
  assert.deepEqual(valid.reads, [{ column: 'telegram_id', value: 4242 }],
    'the DB predicate must retain the validated safe numeric owner')
  const negative = await inspectOwner('-4242', -4242)
  assert.equal(negative.row?.telegram_id, -4242, 'existing safe negative WhatsApp owner remains usable')
  assert.deepEqual(negative.reads, [{ column: 'telegram_id', value: -4242 }])
  const mismatch = await inspectOwner('4243', 4242)
  assert.equal(mismatch.row, null, 'the returned DB owner must match the authenticated owner')
  const absent = await inspectOwner('4244', null)
  assert.equal(absent.row, null, 'missing owner row must fail closed')
  console.log('PASS: Dashboard Chat exact session owner prevents alias/prefix cross-account reads; safe owners retained')
}

// The wrapper never breaks callers that pass a minimal request without clone().
{
  const wrapper = route.slice(route.indexOf('async function withChatChannel(req: NextRequest)'))
  const js = ts.transpileModule(`let calls=0;async function handleChatPost(req){calls++;return {status:200}};async function getSession(){return null};const supabaseAdmin={};const console={error(){}};\n${wrapper.replace('async function withChatChannel(req: NextRequest)', 'async function POST(req)')}\nexports.run=POST;exports.calls=()=>calls`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  runInNewContext(js, { exports, Date, String, parseInt, Promise })
  const res = await exports.run({ json: async () => ({ text: 'hi' }) })
  assert.equal(res.status, 200); assert.equal(exports.calls(), 1)
}

const chat = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
assert.match(chat, /channelRef\.current\?`\/api\/dashboard\/chat\?thread=\$\{encodeURIComponent\(channelRef\.current\)\}`:'\/api\/dashboard\/chat'/)
assert.match(chat, /\.\.\.\(channelRef\.current\?\{threadId:channelRef\.current\}:\{\}\)/)
assert.match(chat, /<ChatChannels channels=\{channels\} active=\{channel\}/)
const bar = readFileSync('components/dashboard/chat-channels.tsx', 'utf8')
assert.match(bar, /One thread/); assert.match(bar, /\+ Channel/)

const sql = readFileSync('supabase/migrations/20261022110000_conversation_channels.sql', 'utf8')
assert.match(sql, /add column if not exists thread_id uuid null references public\.agent_threads\(id\) on delete set null/)
assert.doesNotMatch(sql, /create index/i, 'index is built separately, concurrently')
const idx = readFileSync('supabase/migrations/20261022110100_conversation_channels_index.sql', 'utf8')
assert.match(idx, /create index concurrently if not exists/)
assert.doesNotMatch(idx, /\bbegin\b/i, 'concurrent index cannot run in a transaction')
console.log('Chat channels: owner-scoped channel history, tagging after a successful reply, pre-migration fallback, non-blocking index')
