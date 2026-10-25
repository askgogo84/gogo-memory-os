// 19 Oct live, AskGogo vs Instinct: "Compare iPhone 17 prices on Amazon and Flipkart" defaulted to 128GB although
// the owner's own watch is for the iPhone 17 256GB (Instinct asked "256GB, any colour?").
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
const {storageFromWatchTexts} = await import('../lib/commerce/price-comparison')
const watches = [JSON.stringify({query: 'iPhone 17 256GB price in India below 70000 excluding bank/card offers'}), JSON.stringify({query: 'iPhone 18 Pro 512GB price drop'})]
assert.equal(storageFromWatchTexts('iPhone 17', watches), '256GB')
assert.equal(storageFromWatchTexts('Apple iPhone 17', watches), '256GB')
assert.equal(storageFromWatchTexts('iPhone 17 Pro', watches), null, 'a Pro request never borrows the base model size')
assert.equal(storageFromWatchTexts('iPhone 18 Pro', watches), '512GB')
assert.equal(storageFromWatchTexts('iPhone 18', watches), null, 'base model never borrows the Pro size')
assert.equal(storageFromWatchTexts('iPhone 17 128GB', watches), null, 'an explicit size always wins')
assert.equal(storageFromWatchTexts('iPhone 17', [...watches, JSON.stringify({q: 'iPhone 17 512GB'})]), null, 'conflicting watch sizes → keep the stated default')
assert.equal(storageFromWatchTexts('iPhone 17', []), null)
const src = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
assert.match(src, /\.from\('agent_watchers'\)\.select\('condition_json'\)\.eq\('telegram_id', owner\)\.eq\('active', true\)/, 'owner-bound watch read')
assert.match(src, /like your price watch/)
process.stdout.write('Instinct parity (19 Oct): comparison reuses the size from the owner\'s matching watch, tier-safe.\n')
