import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canonicalizeLinkUrl, detectLinkPlatform, isLinkVaultQuery, isLinkVaultSaveRequest } from '../lib/services/link-vault'

assert.equal(
  canonicalizeLinkUrl('https://www.instagram.com/reel/ABC123/?utm_source=share&igshid=secret#frag'),
  'https://instagram.com/reel/ABC123'
)
assert.equal(
  canonicalizeLinkUrl('https://github.com/samyakjain0606/brain-vault-extension?utm_medium=social'),
  'https://github.com/samyakjain0606/brain-vault-extension'
)
assert.equal(detectLinkPlatform('https://github.com/a/b'),'github')
assert.equal(detectLinkPlatform('https://instagram.com/reel/x'),'instagram')
assert.equal(isLinkVaultSaveRequest('Save this — good reel on consumer app marketing https://instagram.com/reel/abc'),true)
assert.equal(isLinkVaultSaveRequest('Book this restaurant https://example.com/reserve'),false)
assert.equal(isLinkVaultQuery('Find that Instagram reel I saved about marketing'),true)
assert.equal(isLinkVaultQuery('Show all links I saved about agent memory last month'),true)
assert.equal(isLinkVaultQuery('What was that GitHub repo for saving links?'),true)
assert.equal(isLinkVaultQuery('Open the second Instagram link I saved about restaurants'),true)

const svc=fs.readFileSync('lib/services/link-vault.ts','utf8')
const typed=fs.readFileSync('lib/agent/typed-object-context.ts','utf8')
const legacy=fs.readFileSync('lib/feature-intents-legacy.ts','utf8')
const process=fs.readFileSync('lib/bot/process-message.ts','utf8')
const whatsapp=fs.readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const migration=fs.readFileSync('supabase/migrations/20260926173500_link_vault_items.sql','utf8')
const exportRoute=fs.readFileSync('app/api/link-vault/export/route.ts','utf8')
const importRoute=fs.readFileSync('app/api/link-vault/import/route.ts','utf8')

assert.match(migration,/unique \(telegram_id, canonical_url\)/i)
assert.match(migration,/enable row level security/i)
assert.match(migration,/note_history jsonb/i)
assert.match(svc,/sourceTable:'link_vault_items'/)
assert.match(svc,/match_memories/)
assert.match(svc,/content_fetched:false/,'restricted/unread content must not be falsely described as fetched')
assert.match(svc,/auth_required/)
assert.match(svc,/user_note/)
assert.match(svc,/note_history/)
assert.match(svc,/JEV|jevShelf/,'Jev may classify shelf but is not an authority source')
assert.match(svc,/classification, never permission/i)
assert.match(svc,/Updated existing saved link/)
assert.match(svc,/unindexMemory/)
assert.match(svc,/external sends remain approval-gated/i)
assert.match(typed,/'links'/)
assert.match(typed,/link\|reel\|repo\|repository/)
assert.match(legacy,/handleLinkVaultText/)
assert.ok(legacy.indexOf('handleLinkVaultText') < legacy.indexOf('const reelUrl = detectReelUrl'),'Link Vault must get first refusal before legacy social buckets')
assert.match(process,/handleLinkVaultText/)
assert.match(whatsapp,/saveLinkVaultItem/)
assert.match(exportRoute,/Content-Disposition/)
assert.match(exportRoute,/askgogo-link-vault\.json/)
assert.match(importRoute,/verifySameOrigin/)
assert.doesNotMatch(svc,/github\.io|public\s+github\s+pages/i,'public GitHub publishing must not be the default')

console.log('✅ T14 Link Vault: private canonical dedupe, semantic retrieval, typed exact actions and portable JSON')

assert.match(svc,/contextualizeSavedItemReply/,'saved links should pass through Contextual Long Memory association')
assert.match(svc,/kind:'link'/,'Link Vault must identify saved-link association kind')
assert.match(svc,/platform:r\.platform,title:r\.title/,'link association must use canonical saved metadata')
console.log('T14 saved-link contextual association wiring verified')


// Live 3 Oct: a saved meeting link must not capture "Show my watches".
const vm = await import('node:vm')
const ts = await import('typescript')
const { selectedTypedObject } = await import('../lib/agent/typed-object-context')
const context={domain:'links',items:[{id:'saved-meet',title:'Meeting'}],selectedId:'saved-meet',at:new Date().toISOString()}
let linkReads=0
const linkDb={from(){linkReads++;const q:any={select(){return q},eq(){return q},maybeSingle:async()=>({data:{id:'saved-meet',title:'Meeting',canonical_url:'https://meet.google.com/ghm-npbd-uar'},error:null})};return q}}
const exported:any={}
const mocks:any={
  '@/lib/supabase-admin':{supabaseAdmin:linkDb},
  '@/lib/agent/typed-object-context':{latestTypedContext:async()=>context,rememberTypedObjects:async()=>{},selectedTypedObject},
}
vm.runInNewContext(ts.transpileModule(svc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,module:{exports:exported},require:(name:string)=>mocks[name]||{},URL,console})
const fixtureActor={legacyTelegramId:101}
for(const text of ['Show my watches','Show my reminders','Open my calendar','Delete my watches','Remove my reminder','Show that flight']){
  assert.equal(await exported.handleLinkVaultFollowup(fixtureActor,text),null,`saved link must not capture ${text}`)
}
assert.equal(linkReads,0,'unrelated requests must not read or mutate the selected saved link')
for(const text of ['Open it','Show that link','Read the first link','Select the first one']){
  const result=await exported.handleLinkVaultFollowup(fixtureActor,text)
  assert.ok(result.text.includes('https://meet.google.com/ghm-npbd-uar'),`explicit link reference remains supported: ${text}`)
}
console.log('PASS: saved meeting link context cannot capture unrelated watch, reminder or calendar commands')
