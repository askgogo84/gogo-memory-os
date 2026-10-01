import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as reads from '../lib/commerce/swiggy-read'
import * as providers from '../lib/commerce/providers'
import * as addresses from '../lib/commerce/addresses'
import {CommerceMcpClient} from '../lib/commerce/mcp'

const calls:Array<{name:string;args:any}>=[]
const payloads:Record<string,any>={
  get_addresses:{addresses:[{id:'home',addressLine:'Private home',addressTag:'Home'}],pagination:{hasMore:false}},
  search_restaurants:{restaurants:[{id:'r1',name:'Open restaurant',availabilityStatus:'OPEN',distanceKm:1.2,deliveryTimeMinutes:22},{id:'r2',name:'Closed restaurant',availabilityStatus:'CLOSED'},{id:'r3',name:'Unknown availability'}]},
  search_menu:{items:[{menu_item_id:'i1',restaurant_id:'r1',name:'Veg burger',inStock:1,isVeg:true,price:7700,hasVariants:false,hasAddons:false},{menu_item_id:'i2',restaurant_id:'r1',name:'Chicken',inStock:1,isVeg:false},{menu_item_id:'i3',restaurant_id:'r1',name:'Unavailable burger',inStock:0,isVeg:true},{menu_item_id:'i4',restaurant_id:'r2',name:'Other restaurant',inStock:1,isVeg:true},{menu_item_id:'i5',restaurant_id:'r1',name:'Custom burger',inStock:1,isVeg:true,hasVariants:true,hasAddons:false}]},
  search_products:{products:[{productId:'p1',inStock:true,isAvail:true,variations:[{spinId:'spin1',skuId:'sku1',displayName:'Milk',quantityDescription:'1 litre',isInStockAndAvailable:true,price:{mrp:77,offerPrice:77}},{spinId:'spin2',skuId:'sku2',displayName:'Milk',quantityDescription:'500 ml',isInStockAndAvailable:false}]}]},
}
const reader={readTool:async(name:string,args:any)=>{calls.push({name,args});return structuredClone(payloads[name])}}
const restaurants=await reads.readFoodRestaurants(reader,'home','vegetarian burger')
assert.equal(restaurants.length,1)
assert.equal(restaurants[0].distanceKm,1.2)
const menu=await reads.readFoodMenu(reader,'home','vegetarian burger','r1',true)
assert.deepEqual(menu.map(item=>item.id),['i1','i5'])
assert.equal(menu[0].pricePaise,null,'numeric provider prices without verified units must not become rupees')
assert.equal(menu[1].needsCustomization,true)
assert.equal(calls.at(-1)?.args.vegFilter,1)
const products=await reads.readInstamartProducts(reader,'home','Amul milk')
assert.equal(products.length,1)
assert.equal(products[0].variant,'1 litre')
assert.equal(products[0].skuId,'sku1')
assert.equal(reads.explicitInrPaise('₹94.50'),9450)
assert.equal(reads.explicitInrPaise('INR 94'),9400)
assert.equal(reads.explicitInrPaise('94'),null)
assert.equal(reads.explicitInrPaise(9400),null)
const scope={owner:'owner-a',runId:'run-a',service:'grocery' as const,addressId:'home',deliveryContextId:'confirmed-home',basketKey:'milk-1L'}
const expected=[{id:'spin1',variantKey:'sku1',quantity:1}]
payloads.get_cart={cartId:'cart1',selectedAddressDetails:{id:'home',address:'Private street',mobile:'private-phone'},cartTotalAmount:'₹94.50',billBreakdown:{toPay:{label:'To pay',value:'₹94.50'},lineItems:[]},items:[{spinId:'spin1',skuId:'sku1',quantity:1,isInStockAndAvailable:true}]}
const quote=await reads.readInstamartQuote(reader,scope,expected)
assert.equal(quote.payablePaise,9450)
assert.equal(quote.deliveryPaise,null,'missing component fee is not free')
assert.equal(quote.providerUrl,null,'cart IDs are not invented phone URLs')
assert(!JSON.stringify(quote).includes('private-phone'))
await assert.rejects(()=>reads.readInstamartQuote(reader,{...scope,addressId:'other'},expected),/cart_unverified/)
await assert.rejects(()=>reads.readInstamartQuote(reader,scope,[{...expected[0],quantity:2}]),/basket_mismatch/)
payloads.get_cart.cartTotalAmount='94.50'
await assert.rejects(()=>reads.readInstamartQuote(reader,scope,expected),/unit_unverified/)
let network=0
const groceryClient=new CommerceMcpClient('swiggy','grocery','fixture', (async()=>{network++;throw Error('not called')}) as typeof fetch)
await assert.rejects(()=>groceryClient.readTool('search_menu',{}),/tool_not_allowed/)
await assert.rejects(()=>groceryClient.readTool('update_cart',{}),/tool_not_allowed/)
assert.equal(network,0)

// Drive the real catalogue route, persistence and provider adapters together.
process.env.COMMERCE_SWIGGY_ENABLED='true'
const row:any={id:'run-a',telegram_id:'owner-a',type:'food_comparison',status:'paused',updated_at:'2026-01-01T00:00:00Z',summary:'Address selected',metadata_json:{state:'waiting_verified_quote',subject:'vegetarian burger',commerce:{provider:'swiggy',address:{id:'home',page:1,source:'provider_saved_address'}}}}
let owner='owner-a',failSave=false,tokenAvailable=true
const db={from(table:string){assert.equal(table,'agent_runs');const filters:Array<(r:any)=>boolean>=[];let patch:any=null;const q:any={select(){return q},eq(k:string,v:any){filters.push(r=>r[k]===v);return q},update(p:any){patch=p;return q},async maybeSingle(){if(!filters.every(f=>f(row)))return {data:null,error:null};if(patch&&failSave)return {data:null,error:{message:'fixture failure'}};if(patch)Object.assign(row,patch);return {data:structuredClone(row),error:null}}};return q}}
function moduleWith(file:string,deps:Record<string,any>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process,Date,URL,console,require(name:string){if(name in deps)return deps[name];throw Error(name)}});return exports}
const tasks=moduleWith('lib/commerce/task.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./providers':providers})
class Client {async readTool(name:string,args:any){return reader.readTool(name,args)}}
class McpError extends Error {reason='fixture'}
const route=moduleWith('app/api/commerce/tasks/[runId]/catalogue/route.ts',{
  'next/server':{NextResponse:{json:(body:any,options:any)=>({body,status:options?.status||200})}},
  '@/lib/agent/session':{requireAgentMutationOrigin:()=>null,requireAgentSession:async()=>({telegramId:owner}),isAgentSession:()=>true},
  '@/lib/commerce/providers':providers,'@/lib/commerce/task':tasks,'@/lib/commerce/addresses':addresses,'@/lib/commerce/swiggy-read':reads,
  '@/lib/commerce/connection-store':{readCommerceConnection:async()=>tokenAvailable?{accessToken:'fixture'}:null},
  '@/lib/commerce/mcp':{CommerceMcpClient:Client,CommerceMcpError:McpError},
})
const context={params:Promise.resolve({runId:'run-a'})}
const request=(body:any={})=>({json:async()=>body})
owner='owner-b';const before=calls.length
assert.equal((await route.POST(request(),context)).status,409)
assert.equal(calls.length,before,'wrong owner cannot reach provider')
owner='owner-a'
const found=await route.POST(request(),context)
assert.equal(found.status,200)
assert.equal(found.body.runId,'run-a')
assert.equal(found.body.state,'waiting_restaurant_selection')
assert.equal(found.body.catalogue.restaurants.length,1)
assert.match(row.summary,/Open restaurant/)
assert.doesNotMatch(row.summary,/Closed restaurant/)
assert.equal((await route.POST(request({restaurantId:'forged'}),context)).body.error,'refresh_restaurants')
const result=await route.POST(request({restaurantId:'r1'}),context)
assert.equal(result.status,200)
assert.equal(result.body.state,'waiting_item_selection')
assert.equal(result.body.catalogue.items.length,2)
assert.match(row.summary,/not yet verified/)
assert(calls.every(call=>!call.name.includes('update')&&!call.name.includes('checkout')))
failSave=true
assert.equal((await route.POST(request(),context)).status,409,'failed persistence cannot report a successful result')
failSave=false;tokenAvailable=false
assert.equal((await route.POST(request(),context)).status,401)
tokenAvailable=true;payloads.get_addresses.addresses=[]
assert.equal((await route.POST(request(),context)).body.error,'reselect_saved_address')
console.log('PASS: documented Food/Instamart reads, verified availability, diet/restaurant binding, explicit-currency cart quote, exact basket, same-task catalogue route and no cart writes')
