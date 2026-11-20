import assert from 'node:assert/strict'
import {publicSearchPayload,verifiedKeenableResults,searchKeenablePublicShadow,KeenablePublicSearchError} from '../lib/research/keenable-public'
const input={query:'India UPI adoption statistics official NPCI',classification:'public_web_only' as const,
 approval:'server_verified_public' as const,mode:'realtime' as const,maxResults:3}
const body=publicSearchPayload(input)
assert.equal(body.snippet_max_length,600)
assert.equal(body.disable_cards,true)
const results={query:body.query,mode:'realtime',results:[
 {url:'https://npci.org.in/report',title:'NPCI data',snippet:'Official data.',published_at:'2026-11-10T00:00:00Z',acquired_at:'2026-11-12T00:00:00Z'},
 {url:'https://cards.keenable.ai/w/temp',title:'Ephemeral',snippet:'Short-lived card'},
 {url:'http://internal.local/path',title:'Invalid',snippet:'Bad URL'},
 {url:'https://npci.org.in/report',title:'Duplicate',snippet:'Duplicate'},
]}
assert.equal(verifiedKeenableResults(results,body).length,1)
assert.equal(verifiedKeenableResults(results,body)[0].publishedDate,'2026-11-10T00:00:00.000Z')
const fails=(x:any)=>assert.throws(()=>publicSearchPayload(x),
 (e:any)=>e instanceof KeenablePublicSearchError)
fails({...input,classification:'private_user'})
fails({...input,approval:'llm_inferred'})
fails({...input,query:'my inbox receipt from alice@example.com'})
fails({...input,query:'customer otp 123456'})
fails({...input,maxResults:100})
fails({...input,site:'https://example.com/private'})
fails({...input,publishedAfter:'yesterday'})
let calls=0
const fake=async (url:string|URL|Request,opts?:RequestInit)=>{
 calls++
 assert.equal(String(url),'https://api.keenable.ai/v1/search')
 assert.equal((opts?.headers as any)?.['X-API-Key'],'fake-key')
 assert.equal(JSON.parse(String(opts?.body)).max_results,3)
 return new Response(JSON.stringify(results),{status:200,headers:{'Content-Type':'application/json'}})
}
await assert.rejects(searchKeenablePublicShadow(input,{env:{KEENABLE_SHADOW_ENABLED:'false'},request:fake as any}),
 (e:any)=>e.reason==='shadow_disabled')
assert.equal(calls,0)
await assert.rejects(searchKeenablePublicShadow(input,{env:{KEENABLE_SHADOW_ENABLED:'true',NODE_ENV:'production'},request:fake as any}),
 (e:any)=>e.reason==='production_key_required')
assert.equal(calls,0)
const out=await searchKeenablePublicShadow(input,{
 env:{KEENABLE_SHADOW_ENABLED:'true',KEENABLE_API_KEY:'fake-key',NODE_ENV:'production'},
 request:fake as any,
})
assert.equal(out.length,1)
assert.equal(calls,1)
await assert.rejects(searchKeenablePublicShadow(input,{
 env:{KEENABLE_SHADOW_ENABLED:'true',KEENABLE_API_KEY:'fake-key'},
 request:(async()=>new Response('private body',{status:429})) as any,
}),(e:any)=>e.reason==='provider_rate_limited')
console.log('✅ Keenable public-only shadow adapter boundaries passed')
