// Inert P1 regression of ORIGINAL shared-memory module. No provider, real DB, users or sharing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/bot/handlers/shared-memory.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

type User = { telegram_id: unknown; whatsapp_id: string }
function fixture(opts: {
  contact?: string | null; users?: User[]; contactError?: boolean; usersError?: boolean;
  forgedUsers?: User[]; shareError?: boolean; topicExists?: boolean
} = {}) {
  const state = { candidatePhones: [] as string[], suffixCalls: 0, userReads: 0,
    writes: [] as any[], ownerQueries: [] as unknown[], calls: [] as string[] }
  const users = opts.users || []
  const db = {
    from(table: string) {
      state.calls.push(table)
      if (table === 'friend_contacts') {
        const q: any = { select() { return q },
          eq(column: string, value: unknown) { if (column === 'owner_telegram_id') state.ownerQueries.push(value); return q },
          maybeSingle: async () => ({ data: opts.contact === null ? null : { whatsapp_id: opts.contact ?? '+14155552671' },
            error: opts.contactError ? { message: 'synthetic contact failure' } : null }) }
        return q
      }
      if (table === 'users') {
        const q: any = { select() { return q },
          in(column: string, values: string[]) {
            assert.equal(column, 'whatsapp_id')
            state.candidatePhones = values
            return q
          },
          ilike() { state.suffixCalls++; throw Error('suffix recipient lookup forbidden') },
          not() { throw Error('unfiltered recipient search forbidden') },
          order() { throw Error('first-row recipient shortcut forbidden') },
          limit: async (n: number) => {
            assert.equal(n, 2, 'ambiguous recipients must not be silently selected')
            state.userReads++
            return { data: opts.forgedUsers ?? users.filter(u => state.candidatePhones.includes(u.whatsapp_id)),
              error: opts.usersError ? { message: 'synthetic lookup failure' } : null }
          } }
        return q
      }
      if (table === 'memory_shares') return {
        upsert: async (value: any, conflict: any) => {
          assert.deepEqual(JSON.parse(JSON.stringify(conflict)), { onConflict: 'owner_telegram_id,recipient_telegram_id,topic' })
          state.writes.push(JSON.parse(JSON.stringify(value)))
          return { error: opts.shareError ? { message: 'synthetic storage failure' } : null }
        },
      }
      if (table === 'memory_embeddings') {
        const q: any = { select() { return q }, eq() { return q }, ilike() { return q }, is() { return q },
          then(resolve: any, reject: any) { return Promise.resolve({ count: opts.topicExists ? 1 : 0, error: null }).then(resolve, reject) } }
        return q
      }
      throw Error('unexpected table: ' + table)
    },
  }
  const exp: Record<string, any> = {}
  const module = { exports: exp }
  runInNewContext(js, {
    exports: exp, module,
    require(id: string) {
      if (id === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (id === '@/lib/services/embeddings') return { embedText: async () => { throw Error('real embedding forbidden') } }
      if (id === '@/lib/services/memory-index') return { indexMemory: async () => { throw Error('real indexing forbidden') } }
      throw Error('forbidden module: ' + id)
    },
    console: { error() {}, log() {} }, Promise, Date, Number, String, Set, Error,
  })
  return { state, api: module.exports as typeof exp }
}

const sameSuffixWrongCountry = { telegram_id: 2002, whatsapp_id: 'whatsapp:+914155552671' }
const exactRecipient = { telegram_id: 1001, whatsapp_id: 'whatsapp:+14155552671' }
{
  const h = fixture({ users: [sameSuffixWrongCountry, exactRecipient] })
  const resolved = await h.api.resolveRecipientTelegramId(600, 'divya')
  assert.equal(resolved.telegramId, 1001)
  assert.equal(resolved.hasContact, true)
  assert.equal(h.state.suffixCalls, 0)
  assert.ok(!h.state.candidatePhones.includes(sameSuffixWrongCountry.whatsapp_id))
  assert.equal(h.state.writes.length, 0, 'lookup must not share')
}
console.log('PASS same last ten digits from different countries never select wrong owner')
{
  const h = fixture({ users: [sameSuffixWrongCountry] })
  assert.deepEqual(await h.api.resolveRecipientTelegramId(600, 'divya'), { telegramId: null, hasContact: true })
  assert.equal(h.state.writes.length, 0)
}
console.log('PASS no verified recipient = no cross-account authorization')
for (const contact of ['4155552671', 'whatsapp:4155552671', 'bad number', '', '0014155552671']) {
  const h = fixture({ contact, users: [exactRecipient] })
  const out = await h.api.resolveRecipientTelegramId(600, 'divya')
  assert.equal(out.telegramId, null, 'unverified/incomplete contact: ' + contact)
  assert.equal(h.state.userReads, 0)
}
console.log('PASS domestic-only, malformed and missing contact identities fail closed')
{
  const h = fixture({ users: [exactRecipient, { ...exactRecipient, telegram_id: 1010, whatsapp_id: '+14155552671' }] })
  assert.equal((await h.api.resolveRecipientTelegramId(600, 'divya')).telegramId, null)
  assert.equal(h.state.writes.length, 0)
}
console.log('PASS ambiguous full-phone owner rows fail closed')
for (const badId of [null, 0, 9007199254740992, '9007199254740993', '-0', '02', 'undefined']) {
  const h = fixture({ users: [{ telegram_id: badId, whatsapp_id: '+14155552671' }] })
  assert.equal((await h.api.resolveRecipientTelegramId(600, 'divya')).telegramId, null, 'bad owner id: ' + String(badId))
}
console.log('PASS missing and imprecise 64-bit recipient identities fail closed')
for (const condition of [{ contactError: true }, { usersError: true }, { forgedUsers: [sameSuffixWrongCountry] }]) {
  const h = fixture({ ...condition, users: [exactRecipient] })
  assert.equal((await h.api.resolveRecipientTelegramId(600, 'divya')).telegramId, null)
}
{
  const h = fixture({ users: [exactRecipient] })
  assert.equal((await h.api.resolveRecipientTelegramId(Number.MAX_SAFE_INTEGER + 1, 'divya')).telegramId, null)
  assert.equal(h.state.ownerQueries.length, 0)
}
console.log('PASS contact/user database failure, returned row mismatch and unsafe actor fail closed')
{
  const h = fixture({ users: [exactRecipient], topicExists: true })
  assert.match(await h.api.handleBucketCommand(600, 'share my travel topic with divya'), /Shared your/)
  assert.deepEqual(h.state.writes, [{ owner_telegram_id: 600, recipient_telegram_id: 1001, topic: 'travel' }])
}
{
  const h = fixture({ users: [sameSuffixWrongCountry], topicExists: true })
  assert.match(await h.api.handleBucketCommand(600, 'share my travel topic with divya'), /isn.t on AskGogo yet/)
  assert.equal(h.state.writes.length, 0)
}
{
  const h = fixture({ users: [exactRecipient], topicExists: true, shareError: true })
  await assert.rejects(h.api.handleBucketCommand(600, 'share my travel topic with divya'), /shared_memory_grant_unconfirmed/)
  assert.equal(h.state.writes.length, 1, 'uncertain write not blindly retried')
}
console.log('PASS original share handler writes only exact recipient; DB errors never claim success')
