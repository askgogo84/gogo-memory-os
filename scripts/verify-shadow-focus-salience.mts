import assert from 'node:assert/strict'
import { selectShadowFocus } from '../lib/agent/shadow-brain'

const now=new Date()
const fresh=new Date(now.getTime()-2*60_000).toISOString()
const stale=new Date(now.getTime()-60*60_000).toISOString()

const trip={ref:'trip:B8XIQC',summary:'Bengaluru to New York, EY239 / EY1',createdAt:fresh}
const oldTrip={...trip,createdAt:stale}
const mission={id:'hotel-run',title:'Hotel search',summary:'Comparing Times Square hotels',updated_at:fresh}
const staleMission={...mission,updated_at:stale}

let f=selectShadowFocus({text:'Save it to my calendar',contextual:true,mission:staleMission,trip})
assert.equal(f.kind,'trip')
assert.equal(f.ref,'trip:B8XIQC')
assert.equal(f.ambiguous,false)

f=selectShadowFocus({text:'Book the second one',contextual:true,mission,trip:oldTrip})
assert.equal(f.kind,'mission')
assert.equal(f.ref,'run:hotel-run')

f=selectShadowFocus({text:'Monitor the flight',contextual:true,mission,trip})
assert.equal(f.kind,'trip')
assert.equal(f.ambiguous,false)

f=selectShadowFocus({text:'Save it',contextual:true,mission,trip})
assert.equal(f.kind,'none')
assert.equal(f.ambiguous,true)

f=selectShadowFocus({text:'Continue',contextual:true,mission,trip:null})
assert.equal(f.kind,'mission')

f=selectShadowFocus({text:'What is the weather today?',contextual:false,mission:null,trip})
assert.equal(f.kind,'none')

console.log('Shadow focus salience verification passed')
