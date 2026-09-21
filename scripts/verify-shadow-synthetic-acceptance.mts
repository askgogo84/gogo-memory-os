import assert from 'node:assert/strict'
import { shadowActionFamily, shadowNeedsContext, selectShadowFocus } from '../lib/agent/shadow-brain'

const now=Date.now()
const fresh=(mins:number)=>new Date(now-mins*60_000).toISOString()
const stale=(mins:number)=>new Date(now-mins*60_000).toISOString()

const cases=[
  {text:'Save it to my calendar',context:true,action:'calendar'},
  {text:'Monitor it and tell me if anything changes',context:true,action:'monitor'},
  {text:'Book it',context:true,action:'book'},
  {text:'Book the second one',context:true,action:'book'},
  {text:'Order my usual pizza',context:true,action:'buy'},
  {text:'Same as last time',context:true,action:'other'},
  {text:'Remind me tomorrow',context:true,action:'remind'},
  {text:'Send this to Ravi',context:true,action:'send'},
  {text:'Check the flight',context:true,action:'research'},
  {text:'Check travel requirements',context:true,action:'research'},
  {text:'Continue',context:true,action:'other'},
  {text:'Proceed',context:true,action:'other'},
  {text:'What is the weather in Bengaluru today?',context:false,action:'ask'},
  {text:'Create a new grocery list called Sunday',context:false,action:'other'},
]

for(const c of cases){
  assert.equal(shadowNeedsContext(c.text),c.context,c.text+' context')
  assert.equal(shadowActionFamily(c.text),c.action,c.text+' action')
}

const tripFresh={ref:'trip:B8XIQC',summary:'Bengaluru to New York, EY239 / EY1',createdAt:fresh(2)}
const tripOld={...tripFresh,createdAt:stale(120)}
const hotelMissionFresh={id:'hotel-1',title:'Hotel search',summary:'Comparing Midtown hotels',updated_at:fresh(1)}
const hotelMissionOld={...hotelMissionFresh,updated_at:stale(120)}
const docMissionFresh={id:'doc-1',title:'Passport renewal',summary:'Reviewing passport expiry',updated_at:fresh(3)}

let focus=selectShadowFocus({text:'Save it to my calendar',contextual:true,mission:hotelMissionOld,trip:tripFresh})
assert.equal(focus.kind,'trip')
assert.equal(focus.ref,'trip:B8XIQC')

focus=selectShadowFocus({text:'Book the second one',contextual:true,mission:hotelMissionFresh,trip:tripOld})
assert.equal(focus.kind,'mission')
assert.equal(focus.ref,'run:hotel-1')

focus=selectShadowFocus({text:'Monitor the flight',contextual:true,mission:hotelMissionFresh,trip:tripFresh})
assert.equal(focus.kind,'trip')

focus=selectShadowFocus({text:'Save it',contextual:true,mission:hotelMissionFresh,trip:tripFresh})
assert.equal(focus.ambiguous,true)
assert.equal(focus.kind,'none')

focus=selectShadowFocus({text:'Continue',contextual:true,mission:docMissionFresh,trip:null})
assert.equal(focus.kind,'mission')
assert.equal(focus.ref,'run:doc-1')

focus=selectShadowFocus({text:'Check the flight',contextual:true,mission:docMissionFresh,trip:tripOld})
assert.equal(focus.kind,'trip','explicit object reference must beat unrelated mission')

focus=selectShadowFocus({text:'What is the weather in Bengaluru today?',contextual:false,mission:hotelMissionFresh,trip:tripFresh})
assert.equal(focus.kind,'mission','non-contextual turns may retain passive mission context but must not rewrite the request')
assert.equal(focus.ambiguous,false)

console.log('Shadow Brain synthetic acceptance passed')
