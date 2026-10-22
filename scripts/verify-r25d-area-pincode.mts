// R25d (22 Oct live): a food comparison "near Rajajinagar" paused and asked for a PIN code although an
// area was named. A known locality must resolve to its PIN and the comparison must proceed without asking.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as intent from '../lib/agent/food-comparison-intent'

// Locality map: only the listed areas, word-bounded, with common spellings.
const expected:Record<string,string>={
  'near Rajajinagar':'560010','in Rajaji Nagar':'560010','Malleswaram':'560003','Malleshwaram':'560003','Jayanagar':'560041',
  'Koramangala':'560034','Indiranagar':'560038','Indira Nagar':'560038','HSR Layout':'560102','Whitefield':'560066',
  'BTM Layout':'560076','JP Nagar':'560078','J P Nagar':'560078','Basavanagudi':'560004','Hebbal':'560024','Yelahanka':'560064',
  'Electronic City':'560100','Marathahalli':'560037','Banashankari':'560050',
}
for(const [text,pin] of Object.entries(expected))assert.equal(intent.foodAreaLocation(text)?.pin,pin,text)
assert.equal(intent.foodAreaLocation('Find biryani near Rajajinagar')?.area,'Rajajinagar')
assert.equal(intent.foodAreaLocation('near my house'),null,'no area named: nothing is guessed')
assert.equal(intent.foodAreaLocation('Mumbai'),null,'unknown places are not guessed')
assert.equal(intent.foodAreaLocation('hsrlayoutx'),null,'word-bounded match only')

// Location replies: a short locality answer works; an explicit PIN still wins; guards still hold.
assert.deepEqual(intent.foodLocationReply('Rajajinagar'),{pin:'560010',country:'India',area:'Rajajinagar'})
assert.deepEqual(intent.foodLocationReply('Koramangala 560095'),{pin:'560095',country:'India'},'an explicit PIN beats the area map')
assert.equal(intent.foodLocationReply('my OTP for the Koramangala order'),null)
assert.equal(intent.foodLocationReply('I had a long day in meetings and then drove back through Koramangala traffic, which took two hours'),null,'long chat mentioning an area is not a location reply')

// Handler: the exact failure. A fresh request naming an area must search, not ask.
const rows:any[]=[]
const searches:string[]=[]
const db={from(table:string){
  let predicates:Array<(r:any)=>boolean>=[],patch:any=null,insert:any=null,max=Infinity
  const resolve=()=>{
    if(table==='conversations')return {data:[],error:null}
    assert.equal(table,'agent_runs')
    if(insert){const r={id:`run-${rows.length+1}`,...insert};rows.unshift(r);return {data:[r],error:null}}
    const found=rows.filter(r=>predicates.every(p=>p(r))).slice(0,max)
    if(patch)for(const r of found)Object.assign(r,patch)
    return {data:found,error:null}
  }
  const q:any={select(){return q},eq(k:string,v:any){predicates.push(r=>r[k]===v);return q},order(){return q},limit(n:number){max=n;return q},
    insert(r:any){insert=r;return q},update(p:any){patch=p;return q},
    async maybeSingle(){const r=resolve();return {...r,data:r.data?.[0]||null}},async single(){return q.maybeSingle()},
    then(ok:any,bad:any){return Promise.resolve(resolve()).then(ok,bad)},
  };return q
}}
const exports:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/food-comparison.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,URL,console,require(name:string){
  if(name==='@/lib/supabase-admin')return {supabaseAdmin:db}
  if(name==='./food-comparison-intent')return intent
  if(name==='@/lib/commerce/task')return {commerceTaskLink:(id:string)=>'https://app.askgogo.in/dashboard/commerce?run='+id}
  if(name==='@/lib/web-search')return {searchWebResults:async(query:string)=>{searches.push(query);return [{title:'Biryani delivery',snippet:'Rajajinagar 560010',url:'https://www.swiggy.com/city/bangalore/biryani-rajajinagar'}]}}
  throw new Error(`Unexpected dependency ${name}`)
}})
const run=(text:string)=>exports.tryFoodComparison({telegramId:7,text,surface:'whatsapp'})

const request='Find the cheapest biryani delivery near Rajajinagar, compare Swiggy and Zomato'
assert.equal(intent.isFoodComparisonRequest(request),true)
const r=await run(request)
assert.doesNotMatch(r.text,/what is your delivery PIN code/,'R25d: a named area must not trigger the PIN question')
assert.equal(searches.length,3)
assert(searches.every(q=>q.includes('560010')&&q.includes('biryani')),'searches use the resolved PIN')
assert.match(r.text,/Rajajinagar \(PIN 560010/,'reply says which area/PIN was used so the person can correct it')
assert.equal(rows[0].metadata_json.location.pin,'560010')
assert.equal(rows[0].metadata_json.location.source,'user')
assert.equal(rows[0].metadata_json.state,'provider_connection_required')

// An explicit PIN in the request wins over the area map.
searches.length=0
await run('Find the cheapest pizza delivery near Koramangala 560095')
assert.equal(searches.length,3)
assert(searches.every(q=>q.includes('560095')))

// Nothing location-like: still asks (never guesses).
rows.length=0;searches.length=0
const ask=await run('Find me a veg burger nearest my house.. best and the cheapest one compare with all good delivery apps')
assert.match(ask.text,/delivery PIN code/)
assert.equal(searches.length,0)
console.log('PASS: R25d named Bengaluru locality resolves to a PIN and the food comparison proceeds without asking')
