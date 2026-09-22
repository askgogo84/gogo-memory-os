import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseExplicitOpenLoop, isOpenLoopQuery, parseOpenLoopResolution } from '../lib/agent/open-loops'

const wait=parseExplicitOpenLoop("I'm still waiting on Srinivas to send the corrected JSON.")
assert.ok(wait)
assert.equal(wait.kind,'waiting_on')
assert.match(wait.title,/Srinivas/i)

const follow=parseExplicitOpenLoop('I need to follow up with Nithin about the pending salaries.')
assert.ok(follow)
assert.equal(follow.kind,'followup')

const commitment=parseExplicitOpenLoop('I need to send the security approval today.')
assert.ok(commitment)
assert.equal(commitment.kind,'commitment')

assert.equal(parseExplicitOpenLoop('I need to know the weather tomorrow.'),null)
assert.equal(isOpenLoopQuery('What am I waiting on?'),true)
assert.equal(isOpenLoopQuery('What are my open loops?'),true)
assert.equal(isOpenLoopQuery('What meetings do I have tomorrow?'),false)
assert.deepEqual(parseOpenLoopResolution('mark 2 done'),{index:2,mode:'resolved'})
assert.deepEqual(parseOpenLoopResolution('dismiss 3'),{index:3,mode:'dismissed'})

const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const webhook=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const pulse=readFileSync('lib/agent/autonomy-pulse.ts','utf8')
const status=readFileSync('lib/agent/autonomy-status.ts','utf8')
const vercel=readFileSync('vercel.json','utf8')
const migration=readFileSync('supabase/migrations/20260922154000_agent_open_loops.sql','utf8')

assert.match(bridge,/handleOpenLoopQuery/)
assert.match(bridge,/handleOpenLoopResolution/)
assert.match(webhook,/captureExplicitOpenLoopFromTurn/)
assert.match(pulse,/agent_open_loops/)
assert.match(pulse,/Open loop/)
assert.match(status,/Open loops/)
assert.match(vercel,/\/api\/cron\/open-loops/)
assert.match(migration,/create table if not exists public\.agent_open_loops/)
assert.match(migration,/unique \(telegram_id, fingerprint\)/)

console.log('Open-Loops / Attention Engine v1 verification passed')
