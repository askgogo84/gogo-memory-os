/**
 * Gogo TV private market relay: auth, default-deny, quote freshness.
 * Fake data never reaches a user-facing endpoint; tests mock the provider.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/gogo-tv/markets/route'

const token = 'T'.repeat(43)
const validHeader = { Authorization: 'Bearer ' + token }
const hash = createHash('sha256').update(token).digest('hex')
const now = Math.floor(Date.now()/1000)

async function make(headers: Record<string,string> = {}) {
  return GET(new NextRequest('https://app.askgogo.in/api/gogo-tv/markets', { headers }))
}

const originalFetch = globalThis.fetch
const oldEnv = {
  GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256:process.env.GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256,
  GOGO_TV_MARKETS_LICENSE_MODE:process.env.GOGO_TV_MARKETS_LICENSE_MODE,
  GOGO_TV_TWELVEDATA_API_KEY:process.env.GOGO_TV_TWELVEDATA_API_KEY,
  GOGO_TV_MARKETS_SYMBOLS:process.env.GOGO_TV_MARKETS_SYMBOLS,
}
try {
  process.env.GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256 = hash
  process.env.GOGO_TV_MARKETS_LICENSE_MODE = 'personal-display'
  process.env.GOGO_TV_TWELVEDATA_API_KEY = 'FAKE_TEST_KEY_NOT_PRODUCTION'
  process.env.GOGO_TV_MARKETS_SYMBOLS =
    JSON.stringify([{label:'USD/INR',symbol:'USD/INR'}])

  let response = await make()
  assert.equal(response.status,401, 'without device token, deny')

  response = await make({ Authorization: 'Bearer ' + 'Z'.repeat(43) })
  assert.equal(response.status,401, 'wrong token denied')

  delete process.env.GOGO_TV_MARKETS_LICENSE_MODE
  response = await make(validHeader)
  assert.equal(response.status,503, 'must confirm permitted display use')
  process.env.GOGO_TV_MARKETS_LICENSE_MODE = 'personal-display'

  delete process.env.GOGO_TV_TWELVEDATA_API_KEY
  response = await make(validHeader)
  assert.equal(response.status,503, 'no provider key -> no market quotes')
  process.env.GOGO_TV_TWELVEDATA_API_KEY = 'FAKE_TEST_KEY_NOT_PRODUCTION'

  process.env.GOGO_TV_MARKETS_SYMBOLS = '[{"label":"BOGUS","symbol":"AAPL"}]'
  response = await make(validHeader)
  assert.equal(response.status,503, 'unknown symbols denied')
  process.env.GOGO_TV_MARKETS_SYMBOLS = '[{"label":"USD/INR","symbol":"USD/INR"}]'

  let calls=0
  globalThis.fetch = async (_resource: any) => {
    calls++
    return new Response(JSON.stringify({
      symbol:'USD/INR', close:'90.20', percent_change:'0.10',
      last_quote_at:now - 30,
    }), { status:200, headers:{'Content-Type':'application/json'} })
  }

  response = await make(validHeader)
  assert.equal(response.status,200)
  const success = await response.json()
  assert.equal(success.licensedForDisplay,true)
  assert.equal(success.source,'Twelve Data')
  assert.equal(success.quotes.length,1)
  assert.equal(success.quotes[0].symbol,'USD/INR')
  assert.equal(success.quotes[0].value,90.2)
  assert.equal(success.quotes[0].changePct,.1)
  assert.ok(!JSON.stringify(success).includes('FAKE_TEST_KEY'))
  assert.equal(calls,1)

  // Bar opening time alone must not be called a live quote timestamp.
  globalThis.fetch = async () => new Response(JSON.stringify({
    symbol:'USD/INR', close:'90.20', percent_change:'0.10',
    timestamp:now - 30,
  }), { status:200 })
  response = await make(validHeader)
  assert.equal(response.status,503, 'opening-only timestamp is not enough')

  globalThis.fetch = async () => new Response(JSON.stringify({
    symbol:'USD/INR', close:'90.20', percent_change:'0.10',
    last_quote_at:now - 3 * 86400,
  }), { status:200 })
  response = await make(validHeader)
  assert.equal(response.status,503, 'stale data rejected')

  console.log('GOGO_TV_PRIVATE_MARKETS_GATE_OK')
} finally {
  globalThis.fetch = originalFetch
  for (const [key,value] of Object.entries(oldEnv)) {
    if (typeof value === 'undefined') delete process.env[key]
    else process.env[key]=value
  }
}
