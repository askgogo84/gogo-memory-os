import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as model from '../lib/commerce/comparison-model'

// Real 23 Nov request; offline fixtures only. Never start a retailer browser.
const request = 'Compare listed prices for Apple iPhone 16, 128GB, Black across Amazon.in, Flipkart, Croma and Reliance Digital. Include direct source links and mark unavailable prices as unverified. Read only; do not sign in or add anything to a cart.'
const parsed = model.parsePriceComparison(request)!
assert.equal(parsed.subject, 'Apple iPhone 16, 128GB, Black')
assert.equal(parsed.request, request, 'retain all action restrictions in the saved request')
assert.deepEqual(parsed.providers, ['amazon', 'flipkart', 'croma', 'reliance'])
for (const prefix of ['Compare prices for', 'Compare current prices for', 'Compare live prices for', 'Compare the listed price of']) {
  assert.equal(model.parsePriceComparison(`${prefix} Apple iPhone 16, 128GB, Black on Amazon and Croma`)?.subject, parsed.subject)
}
assert.equal(model.parsePriceComparison('Compare Listed Edition Mouse on Amazon and Flipkart')?.subject, 'Listed Edition Mouse', 'do not strip product words')

const black = {url: 'https://www.croma.com/apple-iphone-16-128gb-black-/p/309692', title: 'Apple iPhone 16 (128GB, Black)'}
const wrong = [
  {url: 'https://www.croma.com/apple-iphone-16-128gb-blue-/p/309693', title: 'Apple iPhone 16 (128GB, Blue)'},
  {url: 'https://www.croma.com/apple-iphone-16-256gb-black-/p/309694', title: 'Apple iPhone 16 (256GB, Black)'},
  {url: 'https://www.croma.com/apple-iphone-16e-128gb-black-/p/309695', title: 'Apple iPhone 16e (128GB, Black)'},
]
assert.equal(model.comparisonProductLead('croma', parsed.subject, [...wrong, black]), black.url)
for (const candidate of wrong) assert.equal(model.comparisonProductLead('croma', parsed.subject, [candidate]), null)
assert.match(decodeURIComponent(model.comparisonSearchUrl('amazon', parsed.subject)!), /Apple iPhone 16, 128GB, Black/)
assert.doesNotMatch(model.comparisonSearchUrl('amazon', parsed.subject)!, /listed|prices%20for/)

// Exercise the actual private acknowledgement with all effectful imports inert.
const exports: Record<string, any> = {}
const source = readFileSync(new URL('../lib/commerce/price-comparison.ts', import.meta.url), 'utf8') + '\nexport {startedText}\n'
runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
  exports, process: {env: {}}, URL,
  require(name: string) {
    if (name === './comparison-model') return model
    return new Proxy({}, {get() { return () => {throw Error('unexpected side effect: ' + name)} }})
  },
})
for (const remembered of [null, '128GB']) {
  const text = exports.startedText(parsed.subject, parsed.providers, {}, remembered, request)
  assert.match(text, /\*Apple iPhone 16, 128GB, Black\*/)
  assert.doesNotMatch(text, /any colo[u]?r|256GB.*Black/)
}
assert.match(exports.startedText('iPhone 16', ['croma'], {}), /standard model, not Pro\/Pro Max\/Air, 128GB/)
assert.doesNotMatch(exports.startedText('iPhone 17 Pro 256GB Black', ['croma'], {}), /128GB|standard model|any colour/)
console.log('verify-comparison-request-constraints-nov23: exact request, strict variant leads and real acknowledgement PASS (offline)')
