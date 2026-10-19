// UC9 (20 Oct dashboard): web answers still opened with "Based on the search results".
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { stripSearchPreamble } = await import('../lib/services/claude.ts')
assert.equal(stripSearchPreamble('Based on the search results, the best coworking in Indiranagar is WeWork.'), 'The best coworking in Indiranagar is WeWork.')
assert.equal(stripSearchPreamble('According to the provided sources: petrol is ₹102.92/litre.'), 'Petrol is ₹102.92/litre.')
assert.equal(stripSearchPreamble('Based on the web search results provided, gold is up.'), 'Gold is up.')
// positive controls: ordinary openings are untouched
assert.equal(stripSearchPreamble('Jailer 2 releases on 14 November.'), 'Jailer 2 releases on 14 November.')
assert.equal(stripSearchPreamble('Based on your budget, the Pixel fits best.'), 'Based on your budget, the Pixel fits best.')
console.log('WEB_PREAMBLE_OK')
