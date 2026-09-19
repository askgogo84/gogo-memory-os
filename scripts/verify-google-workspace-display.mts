import assert from 'node:assert/strict'
import { formatEmailSnippet } from '../lib/agent/google-workspace-read'

assert.equal(formatEmailSnippet("I didn&#39;t expect this &amp; that."), "I didn't expect this & that.")
assert.equal(formatEmailSnippet('Short complete sentence.'), 'Short complete sentence.')
const long='First sentence is useful. Second sentence carries more context. Third sentence should be clipped because this string is intentionally much longer than the display budget.'
const out=formatEmailSnippet(long,72)
assert.ok(out.endsWith('.') || out.endsWith('…'))
assert.ok(out.length<=73)
assert.ok(!out.includes('&#39;'))
console.log('google workspace display regression passed')
