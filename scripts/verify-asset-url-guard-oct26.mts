// 26 Oct live (WhatsApp 17:08): "Open https://www.croma.com/… read-only and tell me the price and delivery date for
// my pincode…" was claimed by saved-asset retrieval and answered with a loan agreement. Offline.
// Run: npx --yes tsx scripts/verify-asset-url-guard-oct26.mts
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic'
process.env.OPENAI_API_KEY ||= 'synthetic'
const asset = await import('../lib/services/asset-natural-retrieval')
for (const t of [
  'Open https://www.croma.com/apple-iphone-16-128gb-black-/p/324488 read-only and tell me the price and delivery date for my pincode. Do not add to cart or order.',
  'open www.flipkart.com and find my order',
  'Find the price on https://www.amazon.in/dp/B0DGJHBX5Y',
  'open https://example.com/my-agreement.pdf',
]) assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), false, t)
for (const t of ['find my passport', 'show me my rental agreement', 'open my loan agreement', 'send me the Mythili sales estimate'])
  assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), true, `saved assets still retrievable: ${t}`)
console.log('Messages with a web link are page reads, never saved-asset retrieval')
