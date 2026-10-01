import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {newCommerceFlow, commerceAuthorizeUrl, validateCommerceCallback, exchangeCommerceCode} from '../lib/commerce/oauth'
import {CommerceMcpClient} from '../lib/commerce/mcp'
import {commerceEnabled} from '../lib/commerce/providers'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as vaultCrypto from '../lib/security/vault-crypto'
import * as providers from '../lib/commerce/providers'
import * as oauth from '../lib/commerce/oauth'
import {compareDeliveredQuotes, verifiedCartMatches, renderCommerceQuote, commerceHandoffUrl, type CommerceQuote} from '../lib/commerce/evidence'
import {swiggyAddressPage, chooseSavedAddress} from '../lib/commerce/addresses'

process.env.NEXT_PUBLIC_APP_URL = 'https://app.askgogo.in'
delete process.env.COMMERCE_SWIGGY_ENABLED
assert.equal(commerceEnabled('swiggy'), false, 'deployment alone must not activate provider access')
const flow = newCommerceFlow('swiggy', 'owner-a', 'registered-client')
const url = new URL(commerceAuthorizeUrl(flow))
assert.equal(url.origin, 'https://mcp.swiggy.com')
assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(flow.verifier).digest('base64url'))
assert(!url.href.includes(flow.verifier), 'PKCE verifier stays server-side')
validateCommerceCallback(flow, 'swiggy', 'owner-a', flow.state, null)
assert.throws(() => validateCommerceCallback(flow, 'swiggy', 'owner-b', flow.state, null), /binding/)
assert.throws(() => validateCommerceCallback(flow, 'zepto', 'owner-a', flow.state, null), /binding/)
assert.throws(() => validateCommerceCallback(flow, 'swiggy', 'owner-a', 'wrong-state', null), /state/)
assert.throws(() => validateCommerceCallback(flow, 'swiggy', 'owner-a', flow.state, 'https://evil.example'), /issuer/)
assert.throws(() => validateCommerceCallback(flow, 'swiggy', 'owner-a', flow.state, null, flow.createdAt + 601_000), /binding/)
let exchanges = 0
const token = await exchangeCommerceCode(flow, 'one-use-code', (async (endpoint: any, init: any) => {
  exchanges++
  assert.equal(endpoint, 'https://mcp.swiggy.com/auth/token')
  assert.equal(init.redirect, 'error')
  const body = JSON.parse(init.body)
  assert.equal(body.code_verifier, flow.verifier)
  assert.equal(body.redirect_uri, flow.redirectUri)
  return Response.json({access_token: 'fixture-secret', token_type: 'Bearer', expires_in: 300})
}) as typeof fetch)
assert.equal(token.accessToken, 'fixture-secret')
assert.equal(exchanges, 1)
await assert.rejects(() => exchangeCommerceCode(flow, 'code', (async () => new Response('SENSITIVE PROVIDER BODY', {status: 400})) as typeof fetch), (error: any) => error.message === 'commerce_token_exchange_failed')
await assert.rejects(() => exchangeCommerceCode(flow, 'code', (async () => Response.json({access_token: 'x', token_type: 'Bearer'})) as typeof fetch), /response_invalid/)

const methods: string[] = []
const client = new CommerceMcpClient('swiggy', 'food', 'fixture-secret', (async (endpoint: any, init: any) => {
  assert.equal(endpoint, 'https://mcp.swiggy.com/food')
  assert.equal(init.headers.Authorization, 'Bearer fixture-secret')
  assert.equal(init.redirect, 'error')
  const body = JSON.parse(init.body); methods.push(body.method)
  if (body.method === 'initialize') return Response.json({jsonrpc: '2.0', id: body.id, result: {protocolVersion: '2025-06-18'}}, {headers: {'mcp-session-id': 'session-one'}})
  assert.equal(init.headers['Mcp-Session-Id'], 'session-one')
  assert.equal(init.headers['MCP-Protocol-Version'], '2025-06-18')
  if (body.method === 'notifications/initialized') return new Response(null, {status: 202})
  if (body.method === 'tools/list') return Response.json({jsonrpc: '2.0', id: body.id, result: {tools: [{name: 'get_addresses'}]}})
  assert.equal(body.params.name, 'get_addresses')
  const result = {jsonrpc: '2.0', id: body.id, result: {content: [{type: 'text', text: JSON.stringify({success: true, data: {addresses: [{id: 'home'}]}})}]}}
  return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {headers: {'Content-Type': 'text/event-stream'}})
}) as typeof fetch)
assert.equal((await client.listTools())[0].name, 'get_addresses')
assert.equal((await client.readTool('get_addresses', {})).addresses[0].id, 'home')
const before = methods.length
await assert.rejects(() => client.readTool('place_food_order', {}), /tool_not_allowed/)
await assert.rejects(() => client.readTool('update_food_cart', {}), /tool_not_allowed/)
assert.equal(methods.length, before, 'write tools cannot reach the network through the read client')
assert.equal(methods.filter(x => x === 'initialize').length, 1)
const expired = new CommerceMcpClient('zepto', 'grocery', 'expired', (async () => new Response(null, {status: 401})) as typeof fetch)
await assert.rejects(() => expired.listTools(), /reauth_required/)

// Exercise the real token store and callback boundary with encrypted fixture storage.
process.env.VAULT_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
const rows: any[] = []
const db = {from(table: string) {
  assert.equal(table, 'vault_credentials')
  const filters: Array<(r:any)=>boolean> = []
  let remove = false
  const q: any = {
    select() { return q }, eq(k:string,v:any) { filters.push(r=>r[k]===v); return q },
    async upsert(value:any, options:any) {
      assert.equal(options.onConflict, 'telegram_id,provider,account_label')
      const row = rows.find(r=>r.telegram_id===value.telegram_id&&r.provider===value.provider&&r.account_label===value.account_label)
      if(row)Object.assign(row,value); else rows.push(value)
      return {error:null}
    },
    delete() { remove=true; return q },
    async maybeSingle() { return {data:rows.find(r=>filters.every(f=>f(r)))||null,error:null} },
    then(resolve:any) { if(remove)for(let i=rows.length-1;i>=0;i--)if(filters.every(f=>f(rows[i])))rows.splice(i,1); return Promise.resolve({error:null}).then(resolve) },
  }; return q
}}
function moduleWith(file:string, dependencies:Record<string,any>) {
  const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,console,process,URL,URLSearchParams,Date,Buffer,require(name:string){if(name in dependencies)return dependencies[name];throw new Error(`Unexpected dependency ${name}`)}})
  return exports
}
const store = moduleWith('lib/commerce/connection-store.ts', {'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/security/vault-crypto':vaultCrypto,'./providers':providers})
await store.saveCommerceConnection('owner-a','swiggy',token)
assert(!rows[0].secret_ciphertext.includes('fixture-secret'))
assert(!JSON.stringify(rows[0].metadata_json).includes('fixture-secret'))
assert.equal((await store.readCommerceConnection('owner-a','swiggy')).accessToken, 'fixture-secret')
assert.equal(await store.readCommerceConnection('owner-b','swiggy'),null)
assert.equal(await store.readCommerceConnection('owner-a','zepto'),null)
await store.deleteCommerceConnection('owner-b','swiggy')
assert.equal(rows.length,1,'disconnect cannot delete another owner token')
await store.deleteCommerceConnection('owner-a','swiggy')
assert.equal(rows.length,0)

let callbackOwner='owner-b', callbackCookie=vaultCrypto.encryptVaultValue(JSON.stringify(flow)), callbackExchanges=0
process.env.COMMERCE_SWIGGY_ENABLED='true'
const callback = moduleWith('app/api/commerce/[provider]/callback/route.ts',{
  'next/server':{NextResponse:{json:(body:any,opts:any)=>({body,...opts}),redirect:(location:any,opts:any)=>({location,...opts})}},
  'next/headers':{cookies:async()=>({get:()=>({value:callbackCookie}),set:()=>{callbackCookie=''}})},
  '@/lib/dashboard/session':{getSession:async()=>({telegramId:callbackOwner})},
  '@/lib/security/vault-crypto':vaultCrypto, '@/lib/commerce/providers':providers,
  '@/lib/commerce/oauth':{...oauth,exchangeCommerceCode:async()=>{callbackExchanges++;return token}},
  '@/lib/commerce/connection-store':store,
  '@/lib/commerce/task':{resumeCommerceTaskAfterAuth:async()=>{throw new Error('unexpected task-less continuation')}},
})
const request={url:`https://app.askgogo.in/api/commerce/swiggy/callback?code=fixture-code&state=${flow.state}`}
const wrongOwner=await callback.GET(request,{params:Promise.resolve({provider:'swiggy'})})
assert.match(wrongOwner.location,/connection_failed/)
assert.equal(callbackExchanges,0,'wrong-owner callback cannot exchange the code')
assert.equal(rows.length,0)
callbackOwner='owner-a'; callbackCookie=vaultCrypto.encryptVaultValue(JSON.stringify(flow))
const connected=await callback.GET(request,{params:Promise.resolve({provider:'swiggy'})})
assert.match(connected.location,/result=authorized/)
assert.equal(rows.length,1)
assert.equal(callbackCookie,'')
const replay=await callback.GET(request,{params:Promise.resolve({provider:'swiggy'})})
assert.match(replay.location,/connection_failed/)
assert.equal(callbackExchanges,1,'consumed browser flow does not exchange again')
const quoteScope={owner:'owner-a',runId:'run-a',basketKey:'milk-1L',deliveryContextId:'confirmed-home',service:'grocery' as const}
const quote:CommerceQuote={...quoteScope,provider:'swiggy',addressId:'swiggy-home',observedAt:Date.now(),currency:'INR',evidence:'provider_cart',available:true,
  itemPaise:7700,deliveryPaise:2000,otherFeesPaise:500,discountPaise:0,payablePaise:10200,payableIncludesDelivery:true,
  items:[{id:'milk-swiggy',variantKey:'1L',quantity:1}],cartId:'cart-a',providerUrl:'https://www.swiggy.com/cart'}
const zepto:CommerceQuote={...quote,provider:'zepto',addressId:'zepto-home',cartId:'cart-b',itemPaise:7900,deliveryPaise:1000,otherFeesPaise:500,payablePaise:9400,providerUrl:'https://www.zepto.com/cart',items:[{id:'milk-zepto',variantKey:'1L',quantity:1}]}
assert.equal(compareDeliveredQuotes([quote,zepto],quoteScope).cheapest?.provider,'zepto','rank verified payable total, not lower item price')
assert.equal(compareDeliveredQuotes([quote,{...quote}],quoteScope).comparisonVerified,false,'two snapshots of one provider are not a comparison')
assert.equal(compareDeliveredQuotes([quote,{...zepto,deliveryContextId:'other-home'}],quoteScope).comparisonVerified,false)
assert.equal(compareDeliveredQuotes([quote,{...zepto,payablePaise:null}],quoteScope).comparisonVerified,false)
assert.equal(compareDeliveredQuotes([quote,{...zepto,observedAt:Date.now()-360_000}],quoteScope).comparisonVerified,false)
assert.equal(verifiedCartMatches(quote,quoteScope,quote.items),true)
assert.equal(verifiedCartMatches(quote,quoteScope,[{...quote.items[0],quantity:2}]),false)
assert.equal(verifiedCartMatches(quote,{...quoteScope,owner:'owner-b'},quote.items),false)
assert.match(renderCommerceQuote({...quote,deliveryPaise:null},quoteScope),/Delivery: not provided/,'missing delivery fee must not become free')
assert.match(renderCommerceQuote(quote,quoteScope),/No order has been placed/)
assert.equal(commerceHandoffUrl('swiggy','https://swiggy.com.evil.example/cart'),null)
assert.equal(commerceHandoffUrl('swiggy','https://swiggy.com@evil.example/cart'),null)
const addressPage=swiggyAddressPage({addresses:[{id:'a1',addressLine:'Fixture address 560086',addressTag:'Home',phoneNumber:'secret-phone'}],pagination:{hasMore:false}})
assert(!JSON.stringify(addressPage).includes('secret-phone'))
assert.equal(chooseSavedAddress(addressPage.addresses,'Home')?.id,'a1')
assert.equal(chooseSavedAddress([...addressPage.addresses,{id:'a2',addressLine:'Other address',label:'Home'}],'Home'),null,'ambiguous Home requires selection')
assert.equal(chooseSavedAddress(addressPage.addresses,'unknown-id'),null)
assert.throws(()=>swiggyAddressPage({addresses:[{addressLine:'No id'}],pagination:{hasMore:false}}),/response_invalid/)
console.log('PASS: commerce OAuth owner/state/provider/expiry binding, encrypted owner-scoped storage, callback continuation, MCP JSON/SSE, and write rejection by the read-only tool interface')
console.log('PASS: equivalent-basket delivered-total comparison, fresh owner-bound cart readback, exact quantity and honest fee/link evidence')
