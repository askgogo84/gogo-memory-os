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
  await db.exec(await readFile(new URL('20261112130000_tv_pairing_qr.sql', migrations), 'utf8'))
  await db.exec('set role service_role')
  const startQr = async (suffix, source = 'qr-fixture') => {
    assert.equal((await first(
      'select public.tv_start_qr_pairing($1,$2,$3,$4,$5,$6) as ok',
      [source, 'code-' + suffix, 'session-' + suffix, 'qr-' + suffix, 'poll-' + suffix, 'TCL BeyondTV2'],
    )).ok, true)
    return (await first('select id from public.tv_pairings where qr_hash=$1', ['qr-' + suffix])).id
  }
  const poll = async proof => (await first('select public.tv_poll_qr_pairing($1) as state', [proof])).state
  const review = async (owner, code, qr = null) =>
    first('select * from public.tv_review_qr_pairing($1,$2,$3)', [owner, code, qr])
  const decide = async (owner, id, suffix, approve, qr = 'qr-' + suffix) => (await first(
    'select public.tv_decide_qr_pairing($1,$2,$3,$4,$5) as ok', [owner, id, 'code-' + suffix, qr, approve],
  )).ok

  const id = await startQr('first')
  assert.equal(await poll('qr-first'), 'invalid')
  assert.equal(await poll('session-first'), 'invalid')
  assert.equal(await poll('poll-first'), 'pending')
  assert.equal(await poll('poll-first'), 'slow_down')
  assert.equal(await review('phone-a', 'code-first', 'wrong-qr'), undefined)
  assert.deepEqual(await review('phone-a', 'code-first', 'qr-first'), { id, device_name: 'TCL BeyondTV2', scope: 'ask:read' })
  assert.equal((await review('phone-a', 'code-first')).id, id)
  assert.equal(await decide('phone-a', id, 'first', true, 'wrong-qr'), false)
  const results = await Promise.all([decide('phone-a', id, 'first', true), decide('phone-b', id, 'first', true)])
  assert.equal(results.filter(Boolean).length, 1)
  const winner = results[0] ? 'phone-a' : 'phone-b'
  const other = results[0] ? 'phone-b' : 'phone-a'
  assert.equal(await use('session-first'), undefined)
  await db.query('update public.tv_pairings set next_poll_at=now() where id=$1', [id])
  assert.equal(await poll('poll-first'), 'paired')
  const originalExpiry = (await first('select expires_at from public.tv_pairings where id=$1', [id])).expires_at
  assert.equal(await poll('poll-first'), 'paired')
  assert.deepEqual((await first('select expires_at from public.tv_pairings where id=$1', [id])).expires_at, originalExpiry)
  assert.equal(await use('poll-first'), undefined)
  assert.equal(await use('session-first'), winner)
  assert.equal(await decide(winner, id, 'first', true), false)
  assert.equal(await review(other, 'code-first'), undefined)
  await db.query('update public.tv_pairings set revoked_at=now() where id=$1 and owner_id=$2', [id, other])
  assert.equal(await use('session-first'), winner)
  await db.query('update public.tv_pairings set revoked_at=now() where id=$1 and owner_id=$2', [id, winner])
  assert.equal(await use('session-first'), undefined)
  assert.equal(await poll('poll-first'), 'cancelled')

  const denied = await startQr('denied')
  assert.equal(await decide('phone-a', denied, 'denied', false, null), true)
  assert.equal(await decide('phone-b', denied, 'denied', true), false)
  assert.equal(await poll('poll-denied'), 'denied')
  assert.equal(await use('session-denied'), undefined)
  assert.equal((await first('select denied_by from public.tv_pairings where id=$1', [denied])).denied_by, 'phone-a')

  const cancelled = await startQr('cancelled')
  assert.equal(await decide('phone-a', cancelled, 'cancelled', true), true)
  await db.query("update public.tv_pairings set revoked_at=now() where poll_hash='poll-cancelled'")
  assert.equal(await poll('poll-cancelled'), 'cancelled')
  assert.equal(await use('session-cancelled'), undefined)

  const expired = await startQr('expired')
  assert.equal(await decide('phone-a', expired, 'expired', true), true)
  await db.query("update public.tv_pairings set pair_expires_at=now()-interval '1 second' where id=$1", [expired])
  assert.equal(await poll('poll-expired'), 'expired')
  assert.equal(await use('session-expired'), undefined)

  await startQr('throttle')
  for (let i = 0; i < 20; i++) assert.equal(await review('guesser', 'missing'), undefined)
  assert.equal(await review('guesser', 'code-throttle'), undefined)
  assert.ok(await review('other-account', 'code-throttle'))
  await db.exec('set role authenticated;')
  await assert.rejects(db.query("select public.tv_poll_qr_pairing('poll-throttle')"), /permission denied/)
  await assert.rejects(db.query("select public.tv_review_qr_pairing('owner','code',null)"), /permission denied/)
  await assert.rejects(db.query('select * from public.tv_pairing_review_limits'), /permission denied/)
  await db.exec('reset role; set role service_role;')
  await db.exec('reset role')
  await db.exec(await readFile(new URL('20261112100000_tv_pairing.rollback.sql', migrations), 'utf8'))
  assert.equal((await first("select to_regclass('public.tv_pairings') as relation")).relation, null)
} finally {
  await db.close()
}
console.log('TV protocol, privileges, pairing lifecycle, revocation, throttling and rollback passed')
