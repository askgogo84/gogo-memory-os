// OPENUI-SEARCH-01: source-grounded interactive read-only result cards.
// Inert fixtures only; no provider calls, database queries, bookings or payments.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSearchObservationModel, savedComparisonId, sortSearchObservations } from '../lib/openui/search-observation'

const id='61bdc60d-a901-4fa0-868b-3461790df018'
const amazonUrl='https://www.amazon.in/Sony-WH-1000XM5-Cancelling-Headphones-Connectivity/dp/B0BZP2H373'
const observed={provider:'amazon' as const,status:'observed' as const,sourceUrl:amazonUrl,checkedAt:'2026-10-25T08:00:00Z',evidence:'Sony WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones Mid Night Blue\nListed price ₹24,990'}
const source={
  id,subject:'Sony WH-1000XM5',request:'Compare Sony WH-1000XM5 on Amazon and Flipkart, read only.',
  status:'paused',
  providers:[
    observed,
    {provider:'flipkart' as const,status:'pending' as const,quickPrice:'₹22,000',reason:'Check pending.'},
    {provider:'croma' as const,status:'observed' as const,sourceUrl:'https://www.croma.com/sony/p/236417?access_token=secret',checkedAt:'2026-10-25T09:00:00Z',evidence:'Sony WH-1000XM5\n₹1'},
    {provider:'reliance' as const,status:'pending' as const,waitingForRunId:id},
  ],
}
const model=buildSearchObservationModel(source)
assert.equal(model.items.length,4)
assert.equal(model.observedCount,1,'only clean, allowed observed source counts')
assert.equal(model.pricedCount,1,'search snippets and invalid source URLs cannot create quotes')
assert.equal(model.items[0].observedPrice,'₹24,990')
assert.equal(model.items[0].sourceUrl,amazonUrl)
assert.equal(model.items[1].observedPrice,null,'quick web snippets never count as page evidence')
assert.equal(model.items[2].sourceUrl,null,'token query in product URL must be rejected')
assert.equal(model.items[2].observedPrice,null,'untrusted URL never yields a confirmed price')
assert.equal(model.items[3].observedPrice,null)
assert.equal(model.items[3].handoffPath,'/dashboard/activity/'+id+'/browser')
assert.equal(sortSearchObservations(model.items,'price')[0].provider,'amazon')
assert.equal(sortSearchObservations(model.items,'price')[3].observedPrice,null)
assert.equal(sortSearchObservations(model.items,'name')[0].provider,'amazon')
assert.equal(sortSearchObservations(model.items,'source',true).length,1)

const withoutTimestamp=buildSearchObservationModel({...source,providers:[{...observed,checkedAt:undefined}]})
assert.equal(withoutTimestamp.pricedCount,0,'missing observation time prevents quote')
const mistakenVariant=buildSearchObservationModel({...source,providers:[{...observed,evidence:'Sony WH-1000XM4 Headphones\nListed price ₹99'}]})
assert.equal(mistakenVariant.pricedCount,0,'wrong model variant must not yield price')
const updated=buildSearchObservationModel({...source,providers:[{...observed,evidence:'Sony WH-1000XM5 Headphones\nListed price ₹26,000',checkedAt:'2026-10-25T10:00:00Z'}]})
assert.equal(updated.items[0].observedPrice,'₹26,000','new observed data refreshes exact quote')
assert.equal(model.items[0].observedPrice,'₹24,990','saved earlier snapshot remains immutable')

assert.equal(savedComparisonId('Compare https://app.askgogo.in/dashboard/comparisons/'+id),id)
assert.equal(savedComparisonId('Open /dashboard/comparisons/'+id),id)
assert.equal(savedComparisonId('https://evil.com/dashboard/comparisons/'+id),null)
assert.equal(savedComparisonId('https://app.askgogo.in/dashboard/comparisons/not-an-id'),null)
assert.equal(savedComparisonId('no comparison here'),null)

const inline=readFileSync('components/dashboard/openui-comparison-inline.tsx','utf8')
const cards=readFileSync('components/dashboard/openui-search-results.tsx','utf8')
const page=readFileSync('app/dashboard/(app)/comparisons/[id]/page.tsx','utf8')
const chat=readFileSync('components/dashboard/gogo-chat.tsx','utf8')
assert.match(inline,/\/api\/comparisons\//)
assert.match(inline,/credentials:'same-origin'/)
assert.match(inline,/cache:'no-store'/)
assert.doesNotMatch(inline,/method:\s*'POST'|method:\s*"POST"/)
assert.match(page,/<OpenUISearchResults data=\{report\}\/>/)
assert.match(chat,/<OpenUIComparisonInline text=\{message.content\}\/>/)
assert.match(cards,/comparison|observed source|source observations/i)
assert.match(cards,/Opening a source or rechecking does not buy, book, pay, reserve or change an account/)
assert.doesNotMatch(cards,/fetch\(|POST\b|\.mutation\(|createBooking\(|checkout\(/)
console.log('OpenUI search: 27 grounded read-only result and integration assertions passed')
