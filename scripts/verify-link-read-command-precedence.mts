import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://link-command-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {handleLinkVaultText,isLinkVaultSaveRequest}=await import('../lib/services/link-vault')
const {parseBrowserCommand}=await import('../lib/agent/browser-command')
const url='https://www.instagram.com/zomato/'
const prompts=[
 `Open ${url} and tell me about the latest3 posts`,
 `Read ${url} and tell me about the latest posts`,
 `Please check ${url} for the latest post`,
 `Could you please browse ${url} and tell me what is there?`,
 `Use the browser to research ${url}`,
 `Research ${url}`,
 `Find the latest post on ${url}`,
 `Tell me what is on ${url}`,
 `Look at ${url}`,
 `Search ${url} for the latest updates`,
 `Go to ${url} and read it`,
 `Show me the latest post at ${url}`,
 `Visit ${url} and inspect the posts`,
 `Inspect ${url}`,
 `What is on ${url}?`,
 `Instagram is where I want you to research ${url}`,
 `Do not save ${url}`,
 `Please don't bookmark ${url}`,
]
let io=0
const originalFetch=globalThis.fetch
globalThis.fetch=async()=>{io++;throw new Error('read/negative-save request reached Link Vault I/O')}
try{
 for(const text of prompts){
  let result:unknown
  await assert.doesNotReject(async()=>{result=await handleLinkVaultText({actor:{userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-phone',name:'Fixture'},text,sourceSurface:'web'})},text)
  assert.equal(result,null,text+' must remain available for browser/read routing')
  assert.equal(isLinkVaultSaveRequest(text),false,text)
 }
 assert.equal(io,0,'read commands must not perform storage, metadata enrichment, model or provider I/O')
}finally{globalThis.fetch=originalFetch}
for(const text of [`Save this link — read later: ${url}`,`Could you please save ${url}`,url,`${url} a useful restaurant account`,`Save this link — how to open a browser ${url}`,`Read later: ${url}`,`How to make a perfect dosa — ${url}`,`${url} How to make a perfect dosa`])assert.equal(isLinkVaultSaveRequest(text),true,text)
for(const text of prompts.slice(0,16)){const command=parseBrowserCommand(text);assert.ok(command,text);assert.equal(command.mode,'read');const target=new URL(command.url);assert.equal(target.origin+target.pathname+target.search+target.hash,url);assert.ok(command.objective.includes('zomato'))}
assert.equal(parseBrowserCommand(`Read ${url} then buy the item`)?.mode,'execute','adding a read signal does not downgrade an affirmative purchase')
assert.equal(parseBrowserCommand(`Read ${url} then fill the form`)?.mode,'draft')
assert.equal(parseBrowserCommand(`Read ${url}. Do not buy anything`)?.mode,'read')
console.log('Actual Link Vault entrypoint: URL read commands and negative saves bypass storage with zero I/O; explicit saves, bare shares and browser objectives retained')
