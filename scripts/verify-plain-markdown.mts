// 23 Oct live: Make reports showed raw markdown. Run: npx tsx scripts/verify-plain-markdown.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
const { PlainMarkdown } = await import('../components/dashboard/plain-markdown')
const html = renderToStaticMarkup(createElement(PlainMarkdown, { text: '# Private Research Brief\n## 30 October 2026\n\n---\n\n**Unable to verify.** No calendar.\n- **Booking:** via https://bookings.airmenus.in/eatnaru/order\n- Slots *7:30 pm*\n1. First\n2. Second\n<script>alert(1)</script>' }))
assert.doesNotMatch(html, /# Private|\*\*|---|<script>/, 'no raw markdown, no injected HTML')
assert.match(html, /role="heading" aria-level="3"[^>]*>Private Research Brief</)
assert.match(html, /<strong class="font-semibold">Unable to verify\.<\/strong>/)
assert.match(html, /<ul class="list-disc[^"]*"><li[^>]*><strong[^>]*>Booking:<\/strong> via <a href="https:\/\/bookings\.airmenus\.in\/eatnaru\/order"/)
assert.match(html, /Slots 7:30 pm/, 'single-asterisk emphasis rendered plain (no italics)')
assert.match(html, /<ol class="list-decimal/)
assert.match(html, /&lt;script&gt;/, 'HTML in text is escaped')
assert.match(readFileSync('components/dashboard/report-editor.tsx', 'utf8'), /<PlainMarkdown text=\{section\.text\}/)
assert.match(readFileSync('app/dashboard/(app)/business/[ws]/shared/[id]/page.tsx', 'utf8'), /<PlainMarkdown text=\{section\.text\}/)
assert.match(readFileSync('lib/workspaces/access.ts', 'utf8'), /\/\^-\?\\d\+\$\/\.test\(r\.target\)/, 'audit names negative telegram ids too')
console.log('Plain markdown: headings, bold, lists, links render; no italics; HTML escaped')
