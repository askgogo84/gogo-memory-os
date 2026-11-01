// TEST ONLY / EXPECTED SAFETY RED. Verify durable invite admission on the actual shipped access gate.
// Synthetic Supabase and RPC only: no external calls, users, invites, WhatsApp, or production changes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-test-key'
process.env.ADMIN_WHATSAPP_NUMBERS = '+918310441698'
delete process.env.ACCESS_GATE_ENABLED

const source = readFileSync('lib/access/gate.ts', 'utf8')
assert.match(source, /export async function checkWhatsAppAccess\(/)
assert.match(source, /redeemInvite\(inviteCode, p, profileName\)/)
const { supabaseAdmin } = await import('../lib/supabase-admin.ts')
const { checkWhatsAppAccess } = await import('../lib/access/gate.ts')
assert.equal(typeof checkWhatsAppAccess, 'function', 'must execute current shipped source')

type FakeState = {
  users: any[]
  waitlist: any[]
  fail?: 'insert' | 'update' | 'conflict' | 'no_update' | 'users_read' | 'waitlist_read'
}
let state: FakeState = { users: [], waitlist: [] }
const redemptions: Array<Record<string, any>> = []
const writes: Array<{table: string; operation: string; payload: any}> = []
const LIVE_CODE = 'goverdhan-abc234'
const JOIN = "Hi Gogo, I'm joining with invite " + LIVE_CODE

function reset(next: FakeState = { users: [], waitlist: [] }) {
  state = {
    users: next.users.map(row => ({...row})),
    waitlist: next.waitlist.map(row => ({...row})),
    fail: next.fail,
  }
  redemptions.length = 0
  writes.length = 0
}

function table(tableName: string) {
  assert.ok(tableName === 'users' || tableName === 'waitlist', 'unexpected table: ' + tableName)
  const filters: Array<[string, string, any]> = []
  let operation = 'select'
  let payload: any = null
  const query: any = {
    select(_columns: string) { operation = 'select'; return query },
    in(column: string, values: any[]) { filters.push(['in', column, values]); return query },
    eq(column: string, value: any) { filters.push(['eq', column, value]); return query },
    limit(_n: number) { return query },
    insert(row: any) { operation = 'insert'; payload = row; return query },
    update(row: any) { operation = 'update'; payload = row; return query },
    maybeSingle() { return run(true) },
    then(resolve: any, reject: any) { return run(false).then(resolve, reject) },
  }
  async function run(single: boolean): Promise<any> {
    if ((tableName === 'users' && state.fail === 'users_read') ||
        (tableName === 'waitlist' && operation === 'select' && state.fail === 'waitlist_read')) {
      return {data: null, error: {code: 'DB_READ_DOWN', message: 'synthetic read error'}}
    }
    const rows: any[] = (state as any)[tableName].filter((row: any) =>
      filters.every(([kind, column, value]) =>
        kind === 'in' ? value.includes(row[column]) : row[column] === value))
    if (operation === 'insert') {
      assert.equal(tableName, 'waitlist')
      writes.push({table: tableName, operation, payload})
      if (state.fail === 'insert') return {data: null, error: {code: 'DB_WRITE_DOWN', message: 'synthetic insert failure'}}
      if (state.fail === 'conflict') return {data: null, error: {code: '23505', message: 'synthetic unique conflict'}}
      state.waitlist.push({id: 'synthetic-new-row', ...payload})
      return {data: null, error: null}
    }
    if (operation === 'update') {
      assert.equal(tableName, 'waitlist')
      writes.push({table: tableName, operation, payload})
      if (state.fail === 'update') return {data: null, error: {code: 'DB_WRITE_DOWN', message: 'synthetic update failure'}}
      if (state.fail !== 'no_update') rows.forEach(row => Object.assign(row, payload))
      return {data: null, error: null}
    }
    return {data: single ? (rows[0] || null) : rows, error: null}
  }
  return query
}
;(supabaseAdmin as any).from = table
;(supabaseAdmin as any).rpc = async (name: string, args: Record<string, any>) => {
  assert.equal(name, 'redeem_invite', 'only inert invite redemption RPC permitted')
  redemptions.push({...args})
  if (args.p_code === LIVE_CODE) {
    return {data: [{ok: true, reason: 'joined', redemption_id: 'synthetic-redemption',
      inviter_telegram_id: 100, remaining: 9}], error: null}
  }
  return {data: [{ok: false, reason: 'invalid', redemption_id: null,
    inviter_telegram_id: null, remaining: 0}], error: null}
}

let controls = 0
let safetyPass = 0
let safetyFail = 0
async function control(name: string, test: () => Promise<void>) {
  await test()
  controls++
  console.log('PASS CONTROL: ' + name)
}
async function safety(name: string, test: () => Promise<void>) {
  try {
    await test()
    safetyPass++
    console.log('PASS SAFETY: ' + name)
  } catch (error: any) {
    safetyFail++
    console.error('FAIL SAFETY (expected until fixed): ' + name + ': ' + String(error?.message || error))
  }
}

await control('valid invite for new number creates joined authorization row', async () => {
  reset()
  const result = await checkWhatsAppAccess('+919900000010', 'Synthetic Invitee', JOIN)
  assert.equal(result.allow, true)
  assert.equal(result.reason, 'invited')
  assert.equal(state.waitlist.length, 1)
  assert.equal(state.waitlist[0].status, 'joined')
  assert.equal(state.waitlist[0].phone_e164, '+919900000010')
  assert.equal(redemptions.length, 1)
})
await control('valid invite for an existing waiting number persists joined status', async () => {
  reset({users: [], waitlist: [{id: 'waiting-a', phone_e164: '+919900000011',
    status: 'waiting', last_notified_at: null}]})
  const result = await checkWhatsAppAccess('+919900000011', 'Synthetic Invitee', JOIN)
  assert.equal(result.allow, true)
  assert.equal(state.waitlist[0].status, 'joined')
  assert.equal(redemptions.length, 1)
})
await control('invalid code does not admit a new number', async () => {
  reset()
  const result = await checkWhatsAppAccess('+919900000012', 'Synthetic Invitee', "invite nobody-abc234")
  assert.equal(result.allow, false)
  assert.equal(result.reason, 'waitlist')
  assert.equal(state.waitlist[0].status, 'waiting')
})
await control('blocked account cannot redeem or join via invite', async () => {
  reset({users: [{telegram_id: '200', whatsapp_id: 'whatsapp:+919900000013',
    access_status: 'blocked'}], waitlist: []})
  const result = await checkWhatsAppAccess('+919900000013', 'Synthetic Invitee', JOIN)
  assert.equal(result.allow, false)
  assert.equal(result.reason, 'blocked')
  assert.equal(redemptions.length, 0)
})
await control('read failure fails closed even when invite text is supplied', async () => {
  reset({users: [], waitlist: [], fail: 'users_read'})
  const result = await checkWhatsAppAccess('+919900000014', 'Synthetic Invitee', JOIN)
  assert.equal(result.allow, false)
  assert.equal(result.reason, 'gate_error')
  assert.equal(redemptions.length, 0)
})

await safety('failed new-number waitlist INSERT cannot admit invitee without durable authorization', async () => {
  reset({users: [], waitlist: [], fail: 'insert'})
  const result = await checkWhatsAppAccess('+919900000015', 'Synthetic Invitee', JOIN)
  assert.equal(state.waitlist.length, 0, 'fixture must refuse write')
  assert.equal(redemptions.length, 1, 'RPC has already consumed the valid code')
  assert.equal(result.allow, false, 'admitted invitee although write failed')
})
await safety('failed existing-waiting UPDATE cannot grant a joined status', async () => {
  reset({users: [], waitlist: [{id: 'waiting-b', phone_e164: '+919900000016',
    status: 'waiting', last_notified_at: null}], fail: 'update'})
  const result = await checkWhatsAppAccess('+919900000016', 'Synthetic Invitee', JOIN)
  assert.equal(state.waitlist[0].status, 'waiting', 'fixture must retain waiting status')
  assert.equal(result.allow, false, 'admitted a still-waiting invitee')
})
await safety('conflicting waitlist INSERT cannot be treated as committed without readback', async () => {
  reset({users: [], waitlist: [], fail: 'conflict'})
  const result = await checkWhatsAppAccess('+919900000017', 'Synthetic Invitee', JOIN)
  assert.equal(state.waitlist.length, 0)
  assert.equal(result.allow, false, 'ignored 23505 and claimed joined without verifying target row')
})
await safety('zero-row waitlist UPDATE needs affected-row proof before access', async () => {
  reset({users: [], waitlist: [{id: 'waiting-c', phone_e164: '+919900000018',
    status: 'waiting', last_notified_at: null}], fail: 'no_update'})
  const result = await checkWhatsAppAccess('+919900000018', 'Synthetic Invitee', JOIN)
  assert.equal(state.waitlist[0].status, 'waiting')
  assert.equal(result.allow, false, 'returned joined without a matching committed update')
})
await safety('failed persistence must never expose a completed invite admission receipt', async () => {
  reset({users: [], waitlist: [], fail: 'insert'})
  const result = await checkWhatsAppAccess('+919900000019', 'Synthetic Invitee', JOIN)
  assert.equal(state.waitlist.length, 0)
  assert.notEqual(result.reason, 'invited', 'reported successful admission after durable state failure')
  assert.equal(result.invite, undefined, 'exposed completed redemption receipt for incomplete admission')
})

console.log('RESULT controls=' + controls + ' safety_pass=' + safetyPass + ' safety_fail=' + safetyFail)
assert.equal(controls, 5, 'five safe-path controls must run')
assert.equal(safetyPass, 5,
  'five durable invited-access safety assertions must pass before any release')
console.log('SECURITY GREEN: invite admission requires verified durable owner-bound waitlist authorization')
