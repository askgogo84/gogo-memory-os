import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isActiveListShow, parseActiveListAdd, parseExplicitListShow } from '../lib/bot/handlers/list-conversation-context.ts'

assert.equal(parseExplicitListShow('Show my US trip list'),'US trip')
assert.equal(parseExplicitListShow('show me the us trip list now'),'us trip')
assert.equal(parseExplicitListShow('show groceries'),'groceries')
assert.equal(parseExplicitListShow('show me groceries'),'groceries')
assert.equal(parseExplicitListShow('Show me the list now'),null)
assert.equal(isActiveListShow('Show me the list now'),true)
assert.equal(isActiveListShow('show the list'),true)
assert.deepEqual(parseActiveListAdd('Add travel adapter also'),['travel adapter'])
assert.deepEqual(parseActiveListAdd('Also add passport photocopy and forex card'),['passport photocopy','forex card'])
assert.equal(parseActiveListAdd('Also add a meeting to my calendar tomorrow at 3pm'),null)
assert.equal(parseActiveListAdd('Also add a reminder to call Mom'),null)
assert.equal(parseActiveListAdd('Also add milk to groceries'),null)
assert.equal(parseActiveListAdd('Add meeting to calendar'),null)

const router=fs.readFileSync('lib/feature-intents.ts','utf8')
assert.match(router,/saveFollowupState\(telegramId,'active_list'/,'successful explicit or bare list shows must establish active-list context')
assert.match(router,/parseActiveListAdd\(text\)/,'contextual adds must be deterministic')
assert.match(router,/No LLM\/memory inference is allowed here/,'contextual list followups must not use memory/LLM inference')
assert.match(router,/isActiveListShow\(text\)/,'vague show-list followups must resolve active list')

console.log('✅ Active-list conversational context + destination safety + no-memory-leak regression passed')
