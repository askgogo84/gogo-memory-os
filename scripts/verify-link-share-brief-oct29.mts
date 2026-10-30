// 29 Oct live: a forwarded lnkd.in post was saved as "gjKPc2zn"; another assistant said what it was and offered to dig in.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const lv = await import('../lib/services/link-vault')
const page = (status: number, body = '', location?: string) => new Response(body, { status, headers: location ? { location } : { 'content-type': 'text/html' } })
const calls: string[] = []
const post = '<html><head><title>x</title><meta property="og:title" content="Hone raises $60 million seed from Benchmark and Index Ventures | LinkedIn"><meta property="og:description" content="Hone, a San Francisco AI company, has raised a $60 million seed to build AI that owns business outcomes."></head></html>'
const fake: any = async (u: string) => { calls.push(u); return u.startsWith('https://lnkd.in/') ? page(301, '', 'https://www.linkedin.com/posts/startup-times_hone-activity-1') : page(200, post) }
const p = await lv.linkPreview('https://lnkd.in/p/gjKPc2zn', fake)
assert.equal(p?.title, 'Hone raises $60 million seed from Benchmark and Index Ventures')
assert.match(p!.description, /San Francisco AI company/)
assert.deepEqual(calls, ['https://lnkd.in/p/gjKPc2zn', 'https://www.linkedin.com/posts/startup-times_hone-activity-1'])

// An outside article behind lnkd.in is never fetched: its title comes from its address.
calls.length = 0
const out: any = async (u: string) => { calls.push(u); return page(301, '', 'https://thestartuptimes.com/hone-raises-60-million-seed-from-benchmark-and-index-ventures/') }
const ext = await lv.linkPreview('https://lnkd.in/abc', out)
assert.equal(ext?.title, 'Hone raises 60 million seed from benchmark and index ventures')
assert.deepEqual(calls, ['https://lnkd.in/abc'], 'only LinkedIn hosts are requested')
const inter: any = async (u: string) => { calls.push(u); return page(200, '<title>LinkedIn</title><a class="btn" data-tracking-control-name="external_url_click" href="https://example.com/news/acme-raises-big-new-round-today">Continue</a>') }
calls.length = 0
assert.equal((await lv.linkPreview('https://lnkd.in/xyz', inter))?.title, 'Acme raises big new round today')
assert.equal(calls.length, 1)
assert.equal(await lv.linkPreview('https://lnkd.in/q', (async () => page(200, '<title>Sign Up | LinkedIn</title>')) as any), null, 'a login wall is not a title')
assert.equal(lv.isPreviewHost('https://evil.com/x'), false); assert.equal(lv.isPreviewHost('https://in.linkedin.com/posts/x'), true)
assert.equal(lv.titleFromArticleUrl('https://lnkd.in/p/gjKPc2zn'), null)

// Yes digs in; the reply says what it is.
assert.ok(lv.LINK_DIG_YES.test('Yes')); assert.ok(lv.LINK_DIG_YES.test('dig into it')); assert.ok(!lv.LINK_DIG_YES.test('yes call'))
assert.match(lv.linkDigQuestion({ title: 'Hone raises $60 million seed' }), /^Research this and brief me: Hone raises \$60 million seed\./)
const src = readFileSync('lib/services/link-vault.ts', 'utf8')
assert.match(src, /Saved to your links\. Want me to dig into this\? Reply \*yes\*\./)
console.log('✓ a shared LinkedIn link is read for what it is, outside sites are never fetched, and "yes" digs in')

// 30 Oct live: the post's own text as og:title ran into the description and was cut mid-word.
const live = lv.splitPostTitle('Hone raises $60 million seed from Benchmark and Index Ventures to build AI that owns business outcomes Hone, a San Francisco AI company, has raised a $60 million seed round', 'Hone raises $60 million seed from Benchmark and Index Ventures to build AI that owns business outcomes Hone, a San Francisco AI company, has raised a $60 million seed round led by Benchmark and Index Ventures.')
assert.equal(live.title, 'Hone raises $60 million seed from Benchmark and Index Ventures to build AI that owns business outcomes')
assert.equal(live.description, 'Hone, a San Francisco AI company, has raised a $60 million seed round led by Benchmark and Index Ventures.')
assert.deepEqual(lv.splitPostTitle('Short headline here', 'A separate description.'), { title: 'Short headline here', description: 'A separate description.' })
assert.equal(lv.shortText('one two three four five', 12), 'one two…')
console.log('✓ a long post title is split into a headline and a description that ends on a whole word')

// 30 Oct night, side by side with another assistant: "If you are a Claude freak like me, and you don't…" came back as
// "a Gogo freak … and you don" with no summary.
const page2 = `<meta property="og:title" content="If you are a Claude freak like me, and you don't know how to build sites"><meta property="og:description" content="If you are a Claude freak like me, and you don't know how to build sites: use Claude Code to recreate any site from Awwwards in 58 minutes."><meta name="author" content="Ruben Hassid">`
const pv = await lv.linkPreview('https://www.linkedin.com/posts/x', (async () => new Response(page2, { status: 200 })) as any)
assert.equal(pv?.title, "If you are a Claude freak like me, and you don't know how to build sites", 'an apostrophe never cuts the title')
assert.equal(pv?.author, 'Ruben Hassid')
const sum = await lv.summarizeSharedPost({ title: pv!.title, text: pv!.postText!, author: pv!.author }, async (prompt: string) => {
  assert.match(prompt, /Author: Ruben Hassid/); assert.match(prompt, /mark any numbers/)
  return "That's a how-to post by Ruben Hassid: use Claude Code to recreate any site from Awwwards. He claims it takes about 58 minutes."
})
assert.match(sum!, /^That's a how-to post by Ruben Hassid/)
assert.equal(await lv.summarizeSharedPost({ title: 'x', text: 'short' }, async () => 'never'), null)
const { brandSafe } = await import('../lib/security/outbound-identifiers')
assert.equal(brandSafe(`🔗 ${lv.quotedText('If you are a Claude freak like me')}\n\nI'm Claude.`), "🔗 If you are a Claude freak like me\n\nI'm Gogo.", 'quoted post text stays as written; Gogo still never names itself Claude')
assert.match(readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), /split\(\/\(\\u2063/)
assert.match(readFileSync('components/dashboard/gogo-chat.tsx', 'utf8'), /split\(\/\(\\u2063/)
console.log('✓ shared posts: full title, who posted it and what it says, quoted words never rebranded')
assert.equal(lv.authorFromLinkedInUrl('https://www.linkedin.com/posts/ruben-hassid_if-you-are-a-claude-freak-activity-7389-abc'), 'Ruben Hassid')
assert.equal(lv.authorFromLinkedInUrl('https://www.linkedin.com/posts/startup-times-2_hone-activity-1'), 'Startup Times')
assert.equal(lv.authorFromLinkedInUrl('https://example.com/x'), null)
console.log('✓ the poster is named from the post address when the page does not say')

// 31 Oct: "yes" to a how-to post profiled the author; the guide itself is what was wanted.
const howto = { title: "If you are a Claude freak like me, and you don't know how people are building crazy websites", description: 'this post will show you', author: 'Ruben Hassid' }
assert.equal(lv.isHowToPost(howto), true)
assert.equal(lv.isHowToPost({ title: 'Hone raises $60 million seed from Benchmark and Index Ventures' }), false, 'news stays a facts brief')
assert.match(lv.linkDigQuestion(howto), /^Find the full guide behind this post by Ruben Hassid/)
assert.match(lv.linkDigQuestion({ title: 'Hone raises $60 million seed' }), /^Research this and brief me/)
const drm = await import('../lib/agent/deep-research')
let seen = ''
const guide = await drm.runDeepResearch(lv.linkDigQuestion(howto), { format: 'guide', search: (async () => [{ title: 'Clauned', url: 'https://ruben.substack.com/p/clauned', snippet: 'Remake any site: pick a site, run /goal Remake [URL] with github.com/rubenhassid1/remake' }]) as any, fetchImpl: (async () => new Response('', { status: 404 })) as any, model: async (prompt: string) => { seen += prompt; return prompt.includes('Sources:') ? '1. Pick an inspiration site [1]\n2. Run the prompt [1]\nNeeds: paid plan [1]' : '["remake website guide"]' } })
assert.match(seen, /steps in order as a numbered list/); assert.match(seen, /Do not describe the author/)
assert.match(guide.text, /1\. Pick an inspiration site/)
assert.match(readFileSync('lib/services/link-vault.ts', 'utf8'), /Want the full guide, step by step\?/)
console.log('✓ "yes" to a how-to post brings back the steps, prompt and links, not an author profile')
