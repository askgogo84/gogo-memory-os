// Off-by-default, owner-managed Google Places phone candidates: all mocked, no paid requests.
import assert from 'node:assert/strict'
import {proposeGeneralCallPhoneFromPlaces,uniqueBusinessPlace,verifiedIndiaPhone} from '../lib/agent/general-call-places-phone'
const pid='ChIJ2xUGxbLJ5zsRm0GPvA1yvQ8',name='Naturals Salon',locality='Rajajinagar, Bengaluru'
const good={id:pid,displayName:{text:name},formattedAddress:'12 1st Block, Rajajinagar, Bengaluru, Karnataka 560010, India',businessStatus:'OPERATIONAL'}
const details={...good,internationalPhoneNumber:'+91 80 2345 6789'}
let fetches:any[]=[]
const fakeFetch=(search:any,detail:any)=>{
  fetches=[]
  return async (url:string,init:any)=>{
    fetches.push({url,init})
    return {ok:true,json:async()=>url.endsWith('searchText')?search:detail}
  }
}
const active={GOGO_GENERAL_CALL_PLACES_LOOKUP:'1',GOOGLE_MAPS_API_KEY:'synthetic-only-key'}
assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:name,locality,env:{},fetcher:async()=>{throw Error('must not call')}}),null)
assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:name,locality,env:{GOGO_GENERAL_CALL_PLACES_LOOKUP:'1'},fetcher:async()=>{throw Error('no key')}}),null)
assert.deepEqual(fetches,[])
assert.equal(uniqueBusinessPlace([good],name,locality)?.id,pid)
assert.equal(uniqueBusinessPlace([{...good,displayName:{text:'Naturals Salon Koramangala'}}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,formattedAddress:'Koramangala Bengaluru India'}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,formattedAddress:'Rajajinagar Bengaluru, Nepal'}],name,locality),null)
assert.equal(uniqueBusinessPlace([{...good,businessStatus:'CLOSED_PERMANENTLY'}],name,locality),null)
assert.equal(uniqueBusinessPlace([good,good],name,locality),null)
assert.equal(verifiedIndiaPhone('+91 80 2345 6789'),'+918023456789')
for(const raw of ['+44 20 3456 7890','+91 1800 100 100','+91 1900 100 100','080 2345 6789','+910000000000','+91 98765 432109'])assert.equal(verifiedIndiaPhone(raw),null,raw)
const fetcher=fakeFetch({places:[good]},details)
const out=await proposeGeneralCallPhoneFromPlaces({businessName:name,locality,env:active,fetcher})
assert.deepEqual(out,{
  placeId:pid,name,address:good.formattedAddress,phone:'+918023456789',
  mapUrl:'https://www.google.com/maps/place/?q=place_id:'+pid,source:'Google Places',
  requiresNumberConfirmation:true,isVerifiedPhone:false
})
assert.equal(fetches.length,2)
assert.equal(fetches[0].url,'https://places.googleapis.com/v1/places:searchText')
assert.equal(fetches[0].init.method,'POST')
assert.equal(fetches[0].init.headers['X-Goog-Api-Key'],active.GOOGLE_MAPS_API_KEY)
assert.equal(fetches[0].init.headers['X-Goog-FieldMask'],'places.id,places.displayName,places.formattedAddress,places.businessStatus,nextPageToken')
assert.equal(fetches[1].init.headers['X-Goog-FieldMask'],'id,displayName,formattedAddress,businessStatus,internationalPhoneNumber')
assert.equal(fetches[1].url,'https://places.googleapis.com/v1/places/'+pid)
const query=JSON.parse(fetches[0].init.body)
assert.deepEqual(query,{textQuery:name+', '+locality+', India',pageSize:5,regionCode:'IN',languageCode:'en'})
assert.equal('phone' in (query||{}),false,'no personal phone/task data in Google query')
for(const [why,search,detail,expectedCalls] of [
 ['multiple identical listings',{places:[good,{...good,id:'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ9'}]},details,1],
 ['more pages',{places:[good],nextPageToken:'page-2'},details,1],
 ['wrong venue',{places:[{...good,displayName:{text:'Other Salon'}}]},details,1],
 ['no India location',{places:[{...good,formattedAddress:'Rajajinagar Bengaluru, US'}]},details,1],
 ['replaced details ID',{places:[good]},{...details,id:'ChIJ2xUGxbLJ5zsRm0GPvA1yvQ9'},2],
 ['replaced details name',{places:[good]},{...details,displayName:{text:'Another Salon'}},2],
 ['non-Indian details number',{places:[good]},{...details,internationalPhoneNumber:'+44 2071234567'},2],
 ['no detail number',{places:[good]},{...good},2]
] as const){
  assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:name,locality,env:active,fetcher:fakeFetch(search,detail)}),null,why)
  assert.equal(fetches.length,expectedCalls,why+' stopped safely')
}
assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:'call Naturals Salon tomorrow for my health issue',locality,env:active,fetcher:async()=>{throw Error('No call instructions to Google')}}),null)
assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:name,locality:'08012345678',env:active,fetcher:async()=>{throw Error('No phone queries')}}),null)
assert.equal(await proposeGeneralCallPhoneFromPlaces({businessName:name,locality,env:active,fetcher:async()=>{throw Error('provider unavailable')}}),null)
console.log('PASS: opt-in-only Google Places candidate; exact name/area; stable place ID; no ambiguous, foreign, closed or mismatched phones; NEVER dials, orders, or handles secrets')
