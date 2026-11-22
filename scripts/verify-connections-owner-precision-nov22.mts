// Synthetic Connections identity boundary regression. No provider, session or DB calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'

const file=readFileSync('app/dashboard/(app)/connections/page.tsx','utf8')
assert.match(file,/import \\{ exactSessionOwnerId \\} from '@\\/lib\\/dashboard\\/owner-identity'/)
assert.match(file,/const tg=exactSessionOwnerId\\(session\\?\\.telegramId\\)/)
assert.match(file,/if\\(!session\\|\\|!tg\\)return/, 'reject malformed and missing owners before any read')
assert.doesNotMatch(file,/Number\\(session\\?\\.telegramId\\)|parseInt\\(session\\?\\.telegramId/, 'never round a session owner')
assert.doesNotMatch(file,/\\.eq\\('telegram_id',tgNum\\)/, 'never query a privileged owner row with a rounded number')
const ownerPredicates=file.match(/\\.eq\\('telegram_id',tg\\)/g)||[]
assert.equal(ownerPredicates.length,5,'all five Connections reads are scoped to the exact session owner')
assert.match(file,/BigInt\\(tg\\)>=BigInt\\(Number\\.MIN_SAFE_INTEGER\\)\\&\\&BigInt\\(tg\\)<=BigInt\\(Number\\.MAX_SAFE_INTEGER\\)/)
assert.match(file,/const tgNum=canEncodeGmailOwner\\?Number\\(tg\\):null/)
assert.match(file,/&&tgNum!==null\\s*\\?await import\\('@\\/lib\\/services\\/google-gmail'\\)/,
 'Gmail OAuth must never receive unsafe signed 64-bit IDs')
assert.match(file,/buildGmailSendConnectUrl\\(tgNum\\)/,'preserve signed send-upgrade link for safe owners')
const a='9007199254740992',b='9007199254740993'
assert.equal(Number(a),Number(b),'fixture reproduces the colliding JS Numbers')
assert.notEqual(exactSessionOwnerId(a),exactSessionOwnerId(b),'both 64-bit IDs remain distinct')
assert.equal(exactSessionOwnerId('-9007199254740993'),'-9007199254740993')
for(const invalid of ['0','9007199254740993garbage','9223372036854775808','-9223372036854775809','1.5'])
  assert.equal(exactSessionOwnerId(invalid),null)
console.log('PASS: Connections uses exact 64-bit session owners for all private reads; Gmail OAuth safe-number gate retained.')
