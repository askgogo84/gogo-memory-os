import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalE164Digits, fullPhoneRowCandidates, uniqueExactRecipientId } from '../lib/bot/handlers/shared-memory-recipient'

assert.equal(canonicalE164Digits('whatsapp:+91 88845 01501'), '918884501501')
assert.equal(canonicalE164Digits('whatsapp:+1 8884501501'), '18884501501')
assert.equal(canonicalE164Digits('8884501501'), null)
assert.equal(canonicalE164Digits(null), null)
assert.equal(canonicalE164Digits('+91abc8884501501'), null)
assert.deepEqual(fullPhoneRowCandidates('918884501501'), ['whatsapp:+918884501501','+918884501501','918884501501','whatsapp:918884501501'])
const rows = [
  {telegram_id:111,whatsapp_id:'whatsapp:+918884501501'},
  {telegram_id:222,whatsapp_id:'whatsapp:+18884501501'},
]
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',rows),111)
assert.equal(uniqueExactRecipientId('whatsapp:+18884501501',rows),222)
assert.equal(uniqueExactRecipientId('8884501501',rows),null)
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',[...rows,{telegram_id:333,whatsapp_id:'+918884501501'}]),null)
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',[{telegram_id:111,whatsapp_id:'+918884501501'},{telegram_id:111,whatsapp_id:'918884501501'}]),111)
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',[{telegram_id:Number.MAX_SAFE_INTEGER+2,whatsapp_id:'+918884501501'}]),null)
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',[{telegram_id:null,whatsapp_id:'+918884501501'}]),null)
assert.equal(uniqueExactRecipientId('whatsapp:+918884501501',[]),null)
const code=readFileSync('lib/bot/handlers/shared-memory.ts','utf8')
const start=code.indexOf('export async function resolveRecipientTelegramId(')
const end=code.indexOf('\nexport async function grantShare',start)
assert.ok(start!==-1&&end>start)
const implementation=code.slice(start,end)
assert.doesNotMatch(implementation,/slice\(-10\)|\.ilike\(/)
assert.match(implementation,/fullPhoneRowCandidates\(/)
assert.match(implementation,/uniqueExactRecipientId\(/)
console.log('Shared Memory recipient: synthetic exact E.164 uniqueness and no suffix search PASS')
