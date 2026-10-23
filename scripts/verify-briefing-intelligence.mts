// Morning intelligence (Duet brief Phase 3). Run: npx tsx scripts/verify-briefing-intelligence.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const { composeIntelligence } = await import('../lib/bot/handlers/briefing-intelligence')

const blocks = composeIntelligence({
  approvals: [{ title: 'Send reply to Divya' }, { title: 'Book table' }],
  loops: [
    { title: 'Waiting for reply from Nithin — POS API', priority: 0.94, source_type: 'gmail_thread' },
    { title: 'Waiting for reply from Nithin — POS API', priority: 0.9, source_type: 'gmail_thread' },
    { title: 'Prepare for Divya sync · Fri, 3:00 pm', summary: 'With Divya until 3:30 pm. Read first: “Contract draft” (22 Oct).', priority: 0.87, source_type: 'meeting_prep', due_at: '2026-10-23T09:30:00Z' },
    { title: 'Renew passport someday', priority: 0.5, source_type: 'conversation' },
    { title: 'Old idea', priority: 0.4, source_type: 'conversation' },
  ],
  running: [{ title: 'Compare Instamart prices' }],
  watchers: [{ title: 'Track VS354 (LHR → BOM)' }, { title: null, condition_json: { title: 'Gold price below ₹7,000' } }],
  done: [{ title: 'Weekly expense report' }],
})
const text = blocks.join('\n\n')
assert.match(text, /^🎯 \*Needs you\*\n• 2 approvals waiting: Send reply to Divya and more\n• Waiting for reply from Nithin — POS API$/m)
assert.equal((text.match(/POS API/g) || []).length, 1, 'duplicates collapse')
assert.match(text, /📝 \*Meeting prep\*\n• Prepare for Divya sync · Fri, 3:00 pm\n  With Divya until 3:30 pm\. Read first: “Contract draft” \(22 Oct\)\./)
assert.match(text, /🤖 \*Gogo is handling\*\n• Compare Instamart prices\n• Track VS354 \(LHR → BOM\)\n• Gold price below ₹7,000/)
assert.match(text, /✅ \*Done since yesterday\*\n• Weekly expense report/)
assert.match(text, /⏳ \*Can wait\*\n• 2 lower-priority items/)
assert.deepEqual(composeIntelligence({ approvals: [], loops: [], running: [], watchers: [], done: [] }), [], 'nothing to say → no empty sections')
const src = readFileSync('lib/bot/handlers/briefing-intelligence.ts', 'utf8')
assert.match(src, /if \(r\?\.error\) throw new Error\('briefing_intelligence_unavailable'\)/, 'a failed read omits the section, never claims empty')
assert.match(src, /\.eq\('status', 'completed'\)\.is\('error', null\)\.gte\('updated_at', since\)/, 'done = completed without error in the last 24 h')
const mb = readFileSync('lib/bot/handlers/morning-briefing.ts', 'utf8')
assert.ok(mb.indexOf('loadIntelligence(telegramId)') < mb.indexOf("blocks.push(`🌤️ *Weather*"), 'intelligence leads the brief')
// agent_watchers has no title column (23 Oct live: selecting it emptied Home's 'Gogo is handling').
assert.doesNotMatch(src, /from\('agent_watchers'\)\.select\('[^']*\btitle\b/)
console.log('Morning intelligence: needs you, meeting prep, handling, done, can wait — saved state only, no empty claims')
