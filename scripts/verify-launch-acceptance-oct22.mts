// 22 Oct launch acceptance run on production 0b6c3e7: the routing/parsing defects found live, pinned here.
// Run: npx tsx scripts/verify-launch-acceptance-oct22.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'

const { parsePriceComparison } = await import('../lib/commerce/comparison-model')
const { isNutritionLogText } = await import('../lib/bot/nutrition-text')

// R17 / R18: long comparison prompts with store, pincode and exclusion sentences still reach the store comparison.
{
  const butter = parsePriceComparison('Compare Amul butter 500 g across available stores for my confirmed delivery pincode. Include stock, fees, total and sources. Do not add to cart or order.')
  assert.ok(butter, 'R17 grocery comparison is parsed')
  assert.equal(butter!.subject, 'Amul butter 500 g')
  assert.deepEqual(butter!.providers, ['zepto', 'blinkit', 'instamart'])
  const phone = parsePriceComparison('Compare the base iPhone 17 256GB across stores. Exclude bank/card offers. Include stock, fees and sources. Do not buy.')
  assert.ok(phone, 'R18 phone comparison is parsed')
  assert.match(phone!.subject, /iPhone 17 256GB$/)
  assert.deepEqual(phone!.providers, ['amazon', 'flipkart', 'croma', 'reliance'])
  for (const t of ['Compare my credit cards', 'Compare iPhone 17 vs Pixel 10', 'compare home loan offers across banks', 'Compare Amul butter prices and watch it every day']) {
    assert.equal(parsePriceComparison(t), null, t)
  }
  assert.ok(parsePriceComparison('compare iPhone 17 256GB'), 'the short form still works')
  console.log('✓ R17/R18 comparison prompts keep the store comparison; non-product compares stay out')
}

// R25i: an estimate is a question, never a logged meal.
{
  assert.equal(isNutritionLogText('Estimate the calories in two plain idlis and one cup of sambar.'), false)
  assert.equal(isNutritionLogText('Can you calculate the protein in 200 g paneer'), false)
  assert.equal(isNutritionLogText('log 2 idlis and sambar'), true)
  assert.equal(isNutritionLogText('had 2 idlis and sambar for breakfast'), true)
  console.log('✓ R25i calorie estimates are answered, not logged')
}

// R25b: "Show my goals." (with a full stop) reads agent_goals on web and WhatsApp.
{
  const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
  const src = pm.match(/export const SHOW_GOALS_RE = (\/.+\/i)\n/)?.[1]
  assert.ok(src, 'SHOW_GOALS_RE exists')
  const re = new Function(`return ${src}`)() as RegExp
  for (const t of ['Show my goals.', 'show my goals', 'What are my goals?', 'my active goals', 'list goals']) assert.ok(re.test(t), t)
  for (const t of ['set a goal to walk 8000 steps daily', 'show my goals and delete the walking one', 'goals for 2027 ideas']) assert.equal(re.test(t), false, t)
  assert.match(pm, /if \(SHOW_GOALS_RE\.test\(String\(incomingText \|\| ''\)\.trim\(\)\)\)/, 'goals check runs before chat')
  const wa = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
  assert.match(wa, /\(\?:active\\s\+\)\?goals\\s\*\[\.\?!\]\*\$\/i/, 'WhatsApp goals list accepts a trailing full stop')
  console.log('✓ R25b goals asks with punctuation read saved goals')
}

// R33: understand-first steps aside for an exact supported conversion (lazy, shape-gated).
{
  const uf = readFileSync('lib/agent/understand-first.ts', 'utf8')
  assert.match(uf, /isReferenceFxRequest\?\.\(text\)\) return none\('reference_fx_specialist'\)/)
  console.log('✓ R33 exact conversions go to the dated reference route')
}

console.log('Launch acceptance (22 Oct) routing fixes passed')
