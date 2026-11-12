import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { boundedBody, hash, newCode, newToken, pairingCode, reply, tokenHash } from '../lib/tv/protocol.ts'

for (let count = 0; count < 100; count++) {
  const code = newCode()
  assert.equal(pairingCode(code), code)
  assert.equal(pairingCode(code.match(/.{4}/g).join('-').toLowerCase()), code)
  const token = newToken()
  assert.equal(tokenHash(new Request('https://tv.test', { headers: { authorization: 'Bearer ' + token } })), hash(token))
}
assert.equal(pairingCode('1234'), null)
assert.equal(pairingCode('UUUU-UUUU-UUUU-UUUU'), null)
assert.equal(tokenHash(new Request('https://tv.test', { headers: { authorization: 'Bearer unrelated' } })), null)
assert.equal(reply({}).headers.get('cache-control'), 'no-store')
assert.deepEqual(await boundedBody(new Request('https://tv.test', { method: 'POST', body: 'abc' }), 3), new Uint8Array([97, 98, 99]))
assert.equal(await boundedBody(new Request('https://tv.test', { method: 'POST', body: 'abcd' }), 3), null)

const db = new PGlite()
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  await db.exec(await readFile(new URL('20261112100000_tv_pairing.sql', migrations), 'utf8'))
  const first = async (sql, args) => (await db.query(sql, args)).rows[0]
  await db.exec('set role anon;')
  await assert.rejects(db.query('select * from public.tv_pairings'), /permission denied/)
  await assert.rejects(db.query("select public.tv_start_pairing('1','2','3')"), /permission denied/)
  await db.exec('set role authenticated;')
  await assert.rejects(db.query("select public.tv_approve_pairing('owner','known-code')"), /permission denied/)
  await db.exec('set role service_role;')

  const start = async (source, code, token) => (await first('select public.tv_start_pairing($1,$2,$3) as ok', [source, code, token])).ok
  const approve = async (owner, code) => (await first('select public.tv_approve_pairing($1,$2) as ok', [owner, code])).ok
  const use = async token => (await first("select owner_id from public.tv_pairings where token_hash=$1 and scope='ask:read' and approved_at is not null and revoked_at is null and expires_at > now()", [token]))?.owner_id
  const reserve = async token => (await first("update public.tv_pairings set next_request_at=now()+interval '10 seconds' where token_hash=$1 and scope='ask:read' and approved_at is not null and revoked_at is null and expires_at > now() and next_request_at <= now() returning owner_id", [token]))?.owner_id

  assert.equal(await start('source-a', 'code-a', 'token-a'), true)
  assert.equal(await use('token-a'), undefined)
  assert.equal(await approve('owner-a', 'code-a'), true)
  assert.equal(await approve('owner-b', 'code-a'), false)
  assert.equal(await use('token-a'), 'owner-a')
  assert.equal(await reserve('token-a'), 'owner-a')
  assert.equal(await reserve('token-a'), undefined)
  await db.query("update public.tv_pairings set revoked_at=now() where owner_id=$1 and token_hash='token-a'", ['owner-b'])
  assert.equal(await use('token-a'), 'owner-a')
  await db.query("update public.tv_pairings set revoked_at=now() where owner_id=$1 and token_hash='token-a'", ['owner-a'])
  assert.equal(await use('token-a'), undefined)
  assert.equal(await approve('owner-a', 'code-a'), false)
  assert.equal(await start('source-b', 'code-b', 'token-b'), true)
  await db.exec("update public.tv_pairings set pair_expires_at=now()-interval '1 second' where token_hash='token-b'")
  assert.equal(await approve('owner-b', 'code-b'), false)

  for (let i = 0; i < 12; i++) assert.equal(await start('limited', 'code-' + i, 'token-' + i), true)
  assert.equal(await start('limited', 'blocked-code', 'blocked-token'), false)
  for (let i = 0; i < 8; i++) assert.equal(await approve('owner-c', 'code-' + i), true)
  assert.equal(await approve('owner-c', 'code-8'), false)
  assert.equal(await approve('owner-d', 'code-8'), true)
  await db.exec("update public.tv_pairings set expires_at=now()-interval '1 second' where token_hash='token-8'")
  assert.equal(await use('token-8'), undefined)
  await db.exec('reset role')
  await db.exec(await readFile(new URL('20261112100000_tv_pairing.rollback.sql', migrations), 'utf8'))
  assert.equal((await first("select to_regclass('public.tv_pairings') as relation")).relation, null)
} finally {
  await db.close()
}
console.log('TV protocol, privileges, pairing lifecycle, revocation, throttling and rollback passed')
