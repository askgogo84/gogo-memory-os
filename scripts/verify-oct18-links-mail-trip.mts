import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://state-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.TYPESAFE_API_KEY=''
let links:typeof import('../lib/services/link-vault')
let loops:typeof import('../lib/agent/open-loops')
let executeVerifiedMissionMemory:typeof import('../lib/agent/mission-tools').executeVerifiedMissionMemory
const originalFetch=globalThis.fetch
const originalError=console.error
const errors:string[]=[]
console.error=(...args:any[])=>{errors.push(args.map(String).join(' '))}
let link:any=null
const loopRows:any[]=[]
let inserts=0
let embeddings=0
const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method||'GET'
  if(url.origin==='https://api.github.com')return response({name:'brain-vault-extension',description:'Open-source browser extension for saving links',private:false})
  if(url.origin==='https://api.openai.com'){embeddings++;return response({data:[{embedding:Buffer.alloc(1536*4).toString('base64')}]})}
  assert.equal(url.origin,'https://state-fixture.supabase.co','no live service permitted')
  const body=init?.body?JSON.parse(String(init.body)):null
  const table=url.pathname.split('/').at(-1)
  if(table==='agent_activity'||table==='memory_embeddings')return response(null,201)
  if(table==='match_memories')return response([])
  if(table==='travel_tickets'){
    assert.equal(method,'GET');assert.equal(url.searchParams.get('telegram_id'),'eq.123')
    return response([])
  }
  if(table==='link_vault_items'){
    if(method==='GET'){
      assert.equal(url.searchParams.get('telegram_id'),'eq.123')
      const platform=url.searchParams.get('platform')?.replace('eq.','')
      return response(link&&(!platform||link.platform===platform)?[link]:[])
    }
    if(method==='POST'){assert.equal(body.telegram_id,123);inserts++;link={...body,id:'fixture-link'};return response(link,201)}
    assert.equal(method,'PATCH');assert.equal(url.searchParams.get('telegram_id'),'eq.123');link={...link,...body};return response(link)
  }
  if(table==='agent_open_loops'){
    const owner=url.searchParams.get('telegram_id')?.replace('eq.','')
    if(method==='GET')return response(loopRows.filter(row=>row.telegram_id===owner&&(!url.searchParams.has('fingerprint')||url.searchParams.get('fingerprint')==='eq.'+row.fingerprint)))
    if(method==='POST'){const row={...body,id:'loop-'+loopRows.length};loopRows.push(row);return response({id:row.id},201)}
    assert.equal(method,'PATCH');const row=loopRows.find(row=>row.id===url.searchParams.get('id')?.replace('eq.','')&&row.telegram_id===owner);assert.ok(row);Object.assign(row,body);return response(null)
  }
  throw new Error('Unexpected fixture request '+url.pathname)
}
try{
  links=await import('../lib/services/link-vault')
  loops=await import('../lib/agent/open-loops')
  ;({executeVerifiedMissionMemory}=await import('../lib/agent/mission-tools'))
  const url='https://github.com/samyakjain0606/brain-vault-extension'
  const initial=`Save this link — open-source browser extension for saving links: ${url}`
  assert.ok(links.isLinkVaultSaveRequest(initial))
  await links.saveLinkVaultItem({telegramId:123,text:initial})
  assert.equal(link.title,'brain-vault-extension')
  assert.match(link.user_note,/open-source browser extension/)
  await links.saveLinkVaultItem({telegramId:123,text:`Save this link again — tag it agent memory: ${url}`})
  assert.equal(inserts,1,'resave merges one canonical item')
  assert.ok(link.tags.includes('agent')&&link.tags.includes('memory'))
  assert.doesNotMatch(link.title,/again|tag it/)
  assert.doesNotMatch(link.user_note,/again|tag it/)
  assert.equal((await links.queryLinkVault(123,'What was that GitHub repo for saving links?'))[0]?.id,'fixture-link')
  assert.equal((await links.queryLinkVault(123,'Show all links I saved today'))[0]?.id,'fixture-link')
  assert.ok(embeddings>=2,'save enrichment actually exercised the inert embedding transport')
  assert.equal(links.isLinkVaultSaveRequest('Retrieve the saved Google Meet link: https://meet.google.com/abc-defg-hij'),false)
  assert.equal(links.isLinkVaultQuery('Retrieve the saved Google Meet link:'),true)
  assert.deepEqual(links.savedLinkDayWindow('today',new Date('2026-10-18T00:30:00Z'),'Asia/Kolkata'),{start:'2026-10-17T18:30:00.000Z',end:'2026-10-18T18:30:00.000Z'})
  const notice={id:'message-1',threadId:'thread-1',from:'Billing <no-reply@service.example>',subject:'Payment Failed And Shutdown Coming Soon',snippet:'Payment failed. Service shutdown coming soon.',internalDate:Date.parse('2026-10-18T02:00:00Z')}
  await loops.captureGmailServiceNotices(123,[notice,notice])
  assert.equal(loopRows.length,1)
  assert.equal(loopRows[0].source_type,'gmail_service_notice')
  assert.deepEqual(loopRows[0].source_refs,[{type:'gmail_thread',id:'thread-1'},{type:'gmail_message',id:'message-1'}])
  assert.doesNotMatch(loopRows[0].title,/Reply to/)
  await loops.captureGmailServiceNotices(123,[{...notice,subject:'Newsletter offers',snippet:'20% off, coupon today'}, {...notice,subject:'Payment failed',snippet:'Please try later'}])
  assert.equal(loopRows.length,1)
  assert.equal(loopRows[0].status,'active','ambiguous or absent recovery evidence never closes the notice')
  loopRows[0].status='resolved'
  await loops.captureGmailServiceNotices(123,[notice])
  assert.equal(loopRows[0].status,'resolved','rereading the same notice cannot reopen a resolved item')
  const trip=await executeVerifiedMissionMemory({actor:{userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example Owner'},step:{tool:'memory',title:'Review trip',instruction:'Find travel context'},missionText:'Take care of what you reasonably can for my upcoming trip'})
  assert.match(trip.text,/No upcoming trip for you/)
  assert.equal(trip.output.tripFound,false)
  assert.ok(!('documentId' in trip.output),'no unrelated passport document is substituted')
  assert.deepEqual(errors,[],'no swallowed enrichment, index or reconciliation failures')
}finally{globalThis.fetch=originalFetch;console.error=originalError}
console.log('D8/D9/D11: source-bound service notice, deduped searchable link metadata/tags/date, honest no-trip result passed')
