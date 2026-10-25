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
