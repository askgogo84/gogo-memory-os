// 5 Nov small batch: briefing greeting follows the local hour; "show my usage" counts web searches from usage_events.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const route = readFileSync('app/api/briefing/route.ts', 'utf8')
const start = route.indexOf('function localHour(')
const end = route.indexOf('function formatDateHeader(')
assert.ok(start > 0 && end > start, 'greeting helpers present')
const js = ts.transpileModule(route.slice(start, end) + '\nexport { localHour, greetingForHour }', { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { localHour, greetingForHour } = await import('data:text/javascript,' + encodeURIComponent(js))

assert.equal(greetingForHour(7), '🌅 *Good morning')
assert.equal(greetingForHour(11), '🌅 *Good morning')
assert.equal(greetingForHour(12), '☀️ *Good afternoon')
assert.equal(greetingForHour(16), '☀️ *Good afternoon')
assert.equal(greetingForHour(18), '🌙 *Good evening')
assert.equal(greetingForHour(23), '🌙 *Good evening')
assert.equal(greetingForHour(2), '🌙 *Good evening')
const t = Date.UTC(2026, 10, 5, 13, 6) // 18:36 IST, the live case that said "Good morning"
assert.equal(localHour('Asia/Kolkata', t), 18)
assert.equal(localHour('', t), 18, 'empty timezone falls back to IST')
assert.equal(localHour('Not/AZone', t), 18, 'bad timezone falls back to IST')
assert.equal(localHour('America/New_York', t), 8)
assert.equal(greetingForHour(localHour('Asia/Kolkata', t)), '🌙 *Good evening')
assert.doesNotMatch(route, /🌅 \*Good morning, \$\{/, 'no fixed "Good morning" header left')
assert.match(route, /\$\{greetingForHour\(localHour\(ctx\.timezone\)\)\}, \$\{name\}!\*/)
console.log('✓ briefing greeting follows the local hour (morning / afternoon / evening, IST fallback)')

const limits = readFileSync('lib/data/limits.ts', 'utf8')
assert.match(limits, /async function monthlyWebSearches\(telegramId:number\|string\)/)
assert.match(limits, /from\('usage_events'\)[^\n]*\.eq\('telegram_id',String\(telegramId\)\)\.eq\('counter','ai_action'\)\.eq\('action','web_search'\)\.gte\('created_at',start\)/, 'owner-scoped, web_search only, this month')
assert.match(limits, /const webUsed=Math\.max\(await countUsageFromMemories\(telegramId,'web_search',monthKey\),\(await monthlyWebSearches\(telegramId\)\.catch\(\(\)=>null\)\)\?\?0\)/, 'usage reply takes the larger count and survives a failed read')
assert.match(limits, /usageLine\('Web searches',webUsed,/)
console.log('✓ usage reply counts web searches from usage_events')
console.log('Small batch checks passed')
