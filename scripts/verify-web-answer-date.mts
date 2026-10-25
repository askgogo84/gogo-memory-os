import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 15 Oct live: "Jailer 2 is releasing on 15 October, 2026 … that's in the future!" on 15 Oct. Web answers now carry
// today's India date. Run: npx tsx scripts/verify-web-answer-date.mts
process.env.ANTHROPIC_API_KEY ||= 'fixture'
const { webAnswerDateLine } = await import('../lib/services/claude')
const line = webAnswerDateLine(new Date('2026-10-15T08:00:00Z'))
assert.match(line, /^TODAY: Thursday(,)? 15 October 2026 \(India time\)\./)
assert.match(line, /Never call today's date "the future"/)
// Late evening UTC is already the next day in India.
assert.match(webAnswerDateLine(new Date('2026-10-15T19:00:00Z')), /Friday(,)? 16 October 2026/)
assert.match(readFileSync(new URL('../lib/services/claude.ts', import.meta.url), 'utf8'), /\$\{webAnswerDateLine\(\)\}/)
console.log('verify-web-answer-date: ok')
