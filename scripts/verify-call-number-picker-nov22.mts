// Exercise the exported dashboard action with a synthetic session and inert Google transport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { generalCallPickerEnabled, proposeGeneralCallPhoneFromPlaces } from '../lib/agent/general-call-places-phone'

const owner = '-9223372036854775808'
const env = { GOGO_GENERAL_CALL_PLACES_LOOKUP: '1', GOGO_GENERAL_CALL_PLACES_OWNER: owner, GOOGLE_MAPS_API_KEY: 'fixture-key' }
assert.equal(generalCallPickerEnabled(owner, env), true)
for (const who of [undefined, null, '', '0', '-9223372036854775807', Number(owner)]) {
  assert.equal(generalCallPickerEnabled(who, env), false)
}
for (const overrides of [{GOGO_GENERAL_CALL_PLACES_OWNER:'*'}, {GOGO_GENERAL_CALL_PLACES_LOOKUP:'0'}, {GOOGLE_MAPS_API_KEY:''}]) {
  assert.equal(generalCallPickerEnabled(owner,{...env,...overrides}), false)
}

let session: {telegramId: string} | null = null
const requests: string[] = []
const placeId = 'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8'
const businessName = 'Example Salon'
const locality = 'Rajajinagar, Bengaluru'
const phone = '+918023456789'
const form = new FormData()
for (const [key,value] of Object.entries({businessName,locality,placeId,telegramId:owner})) form.set(key,value)

const moduleExports: Record<string,Function> = {}
const actionText = readFileSync('app/dashboard/(app)/call-number/actions.ts','utf8')
const code = ts.transpileModule(actionText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
runInNewContext(code,{exports:moduleExports,require:(name:string)=>{
  if(name==='@/lib/dashboard/session') return { getSession:async()=>session }
  if(name==='@/lib/agent/general-call-places-phone') return {
    generalCallPickerEnabled:(id:string)=>generalCallPickerEnabled(id,env),
    proposeGeneralCallPhoneFromPlaces:(req:Parameters<typeof proposeGeneralCallPhoneFromPlaces>[0])=>proposeGeneralCallPhoneFromPlaces({...req,env,fetcher:async(url,init)=>{
      requests.push(url)
      assert.equal(init?.method,'GET')
      assert.equal(init?.redirect,'error')
      assert.equal(init?.cache,'no-store')
      return {ok:true,json:async()=>({id:placeId,displayName:{text:businessName},formattedAddress:locality+', Karnataka',
        addressComponents:[{shortText:'IN',types:['country']}],businessStatus:'OPERATIONAL',internationalPhoneNumber:phone})}
    }})
  }
  throw Error('unexpected module '+name)
}})
const submit = () => moduleExports.lookUpBusinessNumber({kind:'found',phone,owner},form)
assert.equal((await submit()).kind,'error')
session={telegramId:'-9223372036854775807'}
assert.equal((await submit()).kind,'error')
assert.equal(requests.length,0)
session={telegramId:owner}
form.set('placeId','raw search text')
assert.equal((await submit()).kind,'error')
assert.equal(requests.length,0)
form.set('placeId',placeId)
const result=await submit()
assert.equal(result.kind,'found')
assert.equal(result.phone,phone)
assert.equal(result.name,businessName)
assert.deepEqual(requests,['https://places.googleapis.com/v1/places/'+placeId])
assert.deepEqual(Object.keys(result).sort(),['address','kind','mapUrl','name','phone'])

const caller=readFileSync('lib/agent/voice-call.ts','utf8')
const prompt=caller.slice(caller.indexOf('if (!general.phone)'),caller.indexOf('const hit = { phone: general.phone'))
assert.match(prompt,/generalCallPickerEnabled\(tg\)/)
assert.match(prompt,/app\.askgogo\.in\/dashboard\/call-number/)
assert.match(prompt,/saveFollowupState\(tg,CALL_NUMBER_STATE/)
assert.doesNotMatch(prompt,/proposeGeneralCallPhoneFromPlaces|placeCall\(/)
console.log('PASS: picker enforces the exact signed-in pilot owner on direct submission and only sends a selected Place ID.')
