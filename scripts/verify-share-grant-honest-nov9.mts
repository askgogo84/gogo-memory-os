// #1336 follow-up: a failed/unknown memory_shares write is never reported as "Shared".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = readFileSync('lib/bot/handlers/shared-memory.ts', 'utf8')
const fn = src.slice(src.indexOf('export async function grantShare'), src.indexOf('export const SHARE_NOT_CONFIRMED'))
assert.match(fn, /const \{ error \} = await supabaseAdmin\s*\.from\('memory_shares'\)/); assert.match(fn, /if \(error\) throw new Error\('shared_memory_grant_unconfirmed'\)/)
assert.match(fn, /Number\.isSafeInteger\(owner\)[\s\S]*Number\.isSafeInteger\(recipient\)/)
assert.match(src, /try \{ await grantShare\(telegramId, rid, share\.topic\) \} catch \{ return SHARE_NOT_CONFIRMED\(share\.topic\) \}/)
const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
const i = pm.indexOf('await grantShare(resolvedUser.telegramId, rid, share.topic)')
assert.ok(i > 0); const around = pm.slice(i - 40, i + 400)
assert.match(around, /^[\s\S]*try \{[\s\S]*await grantShare[\s\S]*reply = `Shared your[\s\S]*\} catch \{ reply = `I couldn't confirm the share/)
console.log('verify-share-grant-honest-nov9: 1 passed')
