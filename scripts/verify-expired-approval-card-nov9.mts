// 9 Nov: an approval past its expiry showed a live "Update calendar" button and only said "expired" after the tap.
// Now: the snapshot does not return expired approvals (so "Needs you" does not count them), and the card itself renders
// an inert "Expired" state if one ever reaches it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const card = readFileSync('components/dashboard/approval-card.tsx', 'utf8')
assert.match(card, /const expired = !!approval\.expiresAt && Number\.isFinite\(Date\.parse\(approval\.expiresAt\)\) && Date\.parse\(approval\.expiresAt\) <= Date\.now\(\)/)
assert.match(card, /\{expired \? <div[^]*?Expired, nothing was done\. Ask again and Gogo prepares a fresh request\.<\/div>\s*: <div className="mt-4 flex flex-col gap-2">/)
assert.match(card, /\{expired \? 'Expired' : 'Expires'\}/)
ok('card: expired approvals render an inert Expired notice instead of yes / Later / Don’t')
const snap = readFileSync('app/api/agent/snapshot/route.ts', 'utf8')
assert.match(snap, /approvals: \(approvals\.data \|\| \[\]\)\.filter\(\(a: any\) => \{ const x = approvalExpiresAt\(a\); return !x \|\| !Number\.isFinite\(Date\.parse\(x\)\) \|\| Date\.parse\(x\) > Date\.now\(\) \}\)\.map/)
ok('snapshot: expired approvals are not returned, so Needs you does not count them')
console.log(`verify-expired-approval-card-nov9: ${n} passed`)
