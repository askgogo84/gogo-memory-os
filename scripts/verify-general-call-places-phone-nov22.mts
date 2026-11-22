// Only owner-selected Google Place IDs may reach the paid Details API. Provider always mocked.
import assert from 'node:assert/strict'
import {proposeGeneralCallPhoneFromPlaces,uniqueBusinessPlace,verifiedIndiaPhone} from '../lib/agent/general-call-places-phone'
const pid='ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8',name='Naturals Salon',locality='Rajajinagar, Bengaluru'
const countryIN=[{types:['country','political'],longText:'India',shortText:'IN'}]
const countryNP=[{types:['country','political'],longText:'Nepal',shortText:'NP'}]
const good={id:pid,displayName:{text:name},formattedAddress:'12 1st Block, Rajajinagar, Bengaluru, Karnataka 560010',addressComponents:countryIN,businessStatus:'OPERATIONAL'}
const details={...good,internationalPhoneNumber:'+91 80 2345 6789'}
const active={GOGO_GENERAL_CALL_PLACES_LOOKUP:'1',GOOGLE_MAPS_API_KEY:'synthetic-only-key'}
const request={businessName:name,locality,placeId:pid,env:active}
const calls:Array<{url:string;init:any}>=[]
const fakeFetch=(detail:any,ok=true)=>async(url:string,init:any)=>{
  calls.push({url,init})
  return {ok,json:async()=>detail}
}
async function noRequest(data:any,reason:string){
  const before=calls.length
  const result=await proposeGeneralCallPhoneFromPlaces({...request,...data,fetcher:fakeFetch(details)})
  assert.equal(result,null,reason)
  assert.equal(calls.length,before,reason+' MUST NOT call the provider')
}
// No owner enablement, no API key, no selected official Place ID, no paid request.
await noRequest({env:{}},'disabled')
await noRequest({env:{GOGO_GENERAL_CALL_PLACES_LOOKUP:'1'}},'missing owner key')
await noRequest({placeId:undefined},'no selected Google Place ID')
await noRequest({placeId:''},'empty place ID')
await noRequest({placeId:'arbitrary venue name'},'free text is not a Place ID')
await noRequest({placeId:'ChIJRavi'},'short fake Place ID')
assert.equal(calls.length,0,'disabled and unselected requests incur no charges')
// Local identity checks do not contact any provider or disclose user text.
assert.equal(uniqueBusinessPlace([good],name,locality)?.id,pid)
assert.equal(uniqueBusinessPlace([{...good,displayName:{text:'Naturals Salon Koramangala'}}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,formattedAddress:'Koramangala Bengaluru India'}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,addressComponents:countryNP}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,addressComponents:[]}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,formattedAddress:'Phase 2, Bengaluru',addressComponents:countryIN}],name,'Phase 1, Bengaluru'),null)
assert.equal(uniqueBusinessPlace([{...good,formattedAddress:'Phase 1, Bengaluru',addressComponents:countryIN}],name,'Phase 1, Bengaluru')?.id,pid)
assert.equal(uniqueBusinessPlace([good],name,'---'),null)
assert.equal(uniqueBusinessPlace([{...good,businessStatus:'CLOSED_PERMANENTLY'}],name,locality),null)
assert.equal(uniqueBusinessPlace([good,good],name,locality),null)
assert.equal(verifiedIndiaPhone('+91 80 2345 6789'),'+918023456789')
for(const raw of ['+44 20 3456 7890','+91 1800 100 100','+91 1900 100 100','080 2345 6789','+910000000000','+91 98765 432109'])assert.equal(verifiedIndiaPhone(raw),null,raw)
// Different ways to smuggle task, sensitive health/travel content, numbers or bogus localities
// must be refused BEFORE even an opaque Place ID is transmitted.
for(const [businessName,localityText] of [
  ['Apollo Hospital','Bengaluru patient Ravi has diabetes'],
  ['Apollo Hospital','Bengaluru cancel my consultation on Monday'],
  [name,'Rajajinagar Bengaluru 98765 43210'],
  [name,'Rajajinagar (080) 2345-6789'],
  [name,'Rajajinagar Bengaluru 560010 560011'],
  [name,'Rajajinagar Bengaluru 000000'],
  [name,'Rajajinagar Bengaluru 5600100'],
  [name,'Rajajinagar Bengaluru 9876543'],
  [name,'Rajajinagar Bengaluru 560010 98765 43210'],
  ['Naturals Salon 560010',locality],
  ['call Naturals Salon tomorrow for my health issue',locality],
  [name,'---'],
] as const)await noRequest({businessName,locality:localityText},'sensitive or invalid free text')
// Valid locality PIN can be verified against returned address; it is never used in provider URL.
const out=await proposeGeneralCallPhoneFromPlaces({...request,locality:'Rajajinagar, Bengaluru 560010',fetcher:fakeFetch(details)})
assert.deepEqual(out,{placeId:pid,name,address:good.formattedAddress,phone:'+918023456789',
  mapUrl:'https://www.google.com/maps/place/?q=place_id:'+pid,source:'Google Places',
  requiresNumberConfirmation:true,isVerifiedPhone:false})
assert.equal(calls.length,1,'one Place Details GET only, never a free-text search')
const first=calls[0]
assert.equal(first.url,'https://places.googleapis.com/v1/places/'+pid)
assert.equal(first.init.method,'GET')
assert.equal(first.init.headers['X-Goog-Api-Key'],active.GOOGLE_MAPS_API_KEY)
assert.equal(first.init.headers['X-Goog-FieldMask'],'id,displayName,formattedAddress,addressComponents,businessStatus,internationalPhoneNumber')
assert.equal(first.init.body,undefined,'no user business/location/patient/task strings sent')
for(const secret of ['Naturals','Rajajinagar','Bengaluru','Ravi','patient','560010'])
 assert.equal(first.url.includes(secret),false,secret+' must not leave in URL')
for(const [why,detail] of [
 ['wrong place ID',{...details,id:'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ9'}],
 ['wrong venue',{...details,displayName:{text:'Other Salon'}}],
 ['wrong locality',{...details,formattedAddress:'Koramangala Bengaluru, Karnataka'}],
 ['foreign country',{...details,addressComponents:countryNP}],
 ['no structured country',{...details,addressComponents:[]}],
 ['closed',{...details,businessStatus:'CLOSED_PERMANENTLY'}],
 ['foreign phone',{...details,internationalPhoneNumber:'+44 2071234567'}],
 ['missing phone',good],
] as const){
  const before=calls.length
  assert.equal(await proposeGeneralCallPhoneFromPlaces({...request,fetcher:fakeFetch(detail)}),null,why)
  assert.equal(calls.length,before+1,why+' exactly one details read, never a dial')
}
assert.equal(await proposeGeneralCallPhoneFromPlaces({...request,fetcher:fakeFetch(details,false)}),null,'provider HTTP error')
assert.equal(await proposeGeneralCallPhoneFromPlaces({...request,fetcher:async()=>{throw Error('provider unavailable')}}),null,'provider network outage')
assert.ok(calls.every(call=>call.url==='https://places.googleapis.com/v1/places/'+pid),
  'NO Text Search, patient, task, business or locality strings ever sent to provider')
console.log('PASS: OFF by default; owner-selected Google Place ID only; no free-text egress; verified local name/area/country, human confirmation, no calls')
