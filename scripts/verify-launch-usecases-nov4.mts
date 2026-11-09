// Launch retest fixes (4 Nov): live findings from the dashboard, each pinned here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'

// 1. "did EK 569 land today?" answered with a 1 Nov landing. Undated status questions only accept yesterday..tomorrow.
{
  const { classifyOccurrence } = await import('../lib/bot/handlers/flight-status')
  const ref = '2026-11-03'
  const stale = { title: 'EK569 Flight Status', snippet: 'Landed 06:50 (+04) on 01-Nov-2026, gate arrival 06:54', url: 'https://www.flightaware.com/live/flight/UAE569' }
  assert.deepEqual(classifyOccurrence(stale, 'did EK 569 land today?', ref), { usable: false, reason: 'date_contradiction' }, '"today" vs 1 Nov')
  const { normalizeNumericDates } = await import('../lib/bot/flight-codes')
  assert.equal(normalizeNumericDates('landed on 01-Nov-2026 and 3-nov-26'), 'landed on 1 Nov 2026 and 3 Nov 2026')
  assert.deepEqual(classifyOccurrence(stale, 'did EK 569 land?', ref), { usable: false, reason: 'stale_date' })
  const today = { ...stale, snippet: 'Landed 06:50 (+04) on 03-Nov-2026' }
  assert.equal(classifyOccurrence(today, 'did EK 569 land?', ref).usable, true)
  const overnight = { ...stale, snippet: 'Departed 02 Nov 2026 23:40, landed 06:50' }
  assert.equal(classifyOccurrence(overnight, 'did EK 569 land?', ref).usable, true, 'an overnight flight from yesterday still counts')
  const staleUrl = { title: 'EK569', snippet: 'Landed 06:50', url: 'https://www.flightaware.com/live/flight/UAE569/history/20261101/0030Z/VOBL/OMDB' }
  assert.deepEqual(classifyOccurrence(staleUrl, 'did EK 569 land?', ref), { usable: false, reason: 'stale_date' })
  const undated = { title: 'EK569 Flight Status', snippet: 'Track Emirates 569 live', url: 'https://www.flightaware.com/live/flight/UAE569' }
  assert.equal(classifyOccurrence(undated, 'did EK 569 land?', ref).usable, true, 'undated pages are left to the existing checks')
  assert.equal(classifyOccurrence(stale, 'did EK 569 land on 1 Nov 2026?', ref).usable, true, 'asking about 1 Nov still gets 1 Nov')
  console.log('✓ flight status: results from another day are dropped unless that day was asked for')
}

// 2. One question looked the flight up twice (brain + status handler). Same live lookup within a minute is shared.
{
  const src = readFileSync('lib/agent/flight-track.ts', 'utf8')
  assert.match(src, /const LIVE_TTL_MS = 60_000/)
  assert.match(src, /if \(fetcher !== fetchAeroDataBox \|\| opts\.search \|\| opts\.crossCheck === false\) return lookupLiveFlightUncached/, 'tests with fake feeds are never cached')
  console.log('✓ flight status: one live-feed lookup per flight per minute')
}
// 3. "scan for jobs now" gave 3 openings, only one with a link. A one-off scan lists job-board results, each with its link.
{
  const j = await import('../lib/agent/jobs')
  for (const yes of ['scan for jobs now', 'Scan for jobs', 'find me jobs', 'search for new openings today', 'any new jobs?'])
    assert.equal(j.isJobScanNow(yes), true, yes)
  for (const no of ['scan for jobs every day', 'show my job applications', 'my job preferences: Head of AI', 'prepare application for FDE at Holistic AI', 'remind me to scan for jobs at 6pm'])
    assert.equal(j.isJobScanNow(no), false, no)
  assert.equal(j.isJobRadarRequest('scan for jobs every day'), true, 'the daily radar is unchanged')
  const out = j.formatJobScan([
    { title: 'Forward Deployed Engineer - Holistic AI | LinkedIn', url: 'https://in.linkedin.com/jobs/view/forward-deployed-engineer-4012345678' },
    { title: '1,240 Forward Deployed Engineer jobs in Bengaluru', url: 'https://www.linkedin.com/jobs/forward-deployed-engineer-jobs' },
    { title: 'Head of AI - Acme Fintech', url: 'https://jobs.lever.co/acme/5f1c' },
    { title: 'Forward Deployed Engineer - Holistic AI', url: 'https://www.linkedin.com/jobs/view/dup' },
    { title: 'Some blog about FDE roles', url: 'https://medium.com/x' },
    { title: 'Head of AI · insecure', url: 'http://naukri.com/job/1' },
  ], 'Forward Deployed Engineer OR Head of AI')
  assert.match(out, /^💼 \*Openings for Forward Deployed Engineer OR Head of AI\*/)
  assert.match(out, /1\. \*Forward Deployed Engineer - Holistic AI\* · linkedin\.com\nhttps:\/\/in\.linkedin\.com\/jobs\/view\//)
  assert.match(out, /2\. \*Head of AI - Acme Fintech\* · jobs\.lever\.co\nhttps:\/\/jobs\.lever\.co\/acme\/5f1c/)
  assert.doesNotMatch(out, /1,240|medium\.com|http:\/\/|\n3\./, 'listing pages, non-job sites, insecure links and duplicates are dropped')
  assert.match(out, /I never apply for you\./)
  assert.match(j.formatJobScan([], 'Head of AI'), /found no individual openings just now/)
  const cmd = readFileSync('lib/agent/jobs-command.ts', 'utf8')
  assert.match(cmd, /checkCostAllowance[\s\S]{0,700}searchWebResults\(query, \{ includeDomains: JOB_BOARD_DOMAINS \}\)[\s\S]{0,300}includeDomains: \['greenhouse\.io', 'lever\.co', 'ashbyhq\.com'\][\s\S]{0,300}recordCostEvent/, 'scan is within the cost allowance, searches boards and company job sites, and is recorded')
  console.log('✓ job scan now: every opening listed has its own link; listing pages, duplicates and non-job sites dropped')
}
// 4. "What's scheduled" showed "…below" and "256GB 256GB". Watch lines use the shared name and rule, cut at a word.
{
  const sl: any = await import('../lib/agent/scheduled-list')
  const items = { reminders: [], watchers: [
    { id: 'a', type: 'product_price', condition_json: { title: 'Watch: Samsung Galaxy S25 Ultra 256GB 256GB price in India below ₹1,10,000', targetPrice: 110000 }, cadence_minutes: 360 },
    { id: 'b', type: 'web_search', condition_json: { title: 'News: Reserve Bank of India repo rate decision announcement and market reaction for home loan borrowers in metro cities' }, cadence_minutes: 1440 },
  ], goals: [], briefing: null, checkIns: null }
  const text: string = sl.composeScheduledList(items, { timezone: 'Asia/Kolkata', now: Date.parse('2026-11-04T06:00:00Z') })
  assert.doesNotMatch(text, /256GB 256GB/)
  assert.doesNotMatch(text, /\bbelow\s*(?:·|$|\n)/, 'no dangling "below"')
  assert.match(text, /Samsung Galaxy S25 Ultra 256GB · alert below ₹1,10,000/)
  const news = text.split('\n').find(l => /Reserve Bank/.test(l))!
  assert.match(news, /… · new results/, 'a long title is cut at a word with an ellipsis')
  console.log('✓ what\'s scheduled: watch names without repeats or dangling words, with the alert rule')
}
// 5. Salon results list numbers with no label; the privacy filter hid them. Indian phone layouts show on their own.
{
  const r = await import('../lib/bot/memory-redaction')
  for (const shown of ['Envi Salon · 080 4123 4567 · 4.5★', 'Naturals · 98450 12345', 'Green Trends 📞 9845012345', 'Envi 080-41234567', 'Lakme 098450 12345'])
    assert.equal(r.redactSecretShapedText(shown), shown, shown)
  for (const hidden of ['card 4111 1111 1111 1111', 'ref 2345 6789 0123', 'acct 50100234567891', 'number 9845012345', 'id 0123 4567 8901 2345'])
    assert.match(r.redactSecretShapedText(hidden), /\[sensitive detail withheld\]/, hidden)
  assert.equal(r.isSecretShapedMemory('Envi Salon Rajajinagar 080 4123 4567'), false)
  assert.equal(r.isSecretShapedMemory('my card 4111 1111 1111 1111'), true)
  console.log('✓ privacy filter: landline and 5+5 mobile layouts shown; card, Aadhaar-style and account numbers still hidden')
}
// 6. Live after #1254: the scan listed Indeed search pages; salon results never showed the phone they carried.
{
  const j = await import('../lib/agent/jobs')
  const out = j.formatJobScan([
    { title: 'Forward deployed ai engineer jobs', url: 'https://www.indeed.com/q-forward-deployed-ai-engineer-jobs.html' },
    { title: 'Forward Deployed Engineer jobs in Remote', url: 'https://www.indeed.com/q-forward-deployed-engineer-l-remote-jobs.html' },
    { title: 'Forward Deployed Engineer - Sarvam AI', url: 'https://in.indeed.com/viewjob?jk=abc123' },
    { title: 'Head of AI - Razorpay', url: 'https://www.naukri.com/job-listings-head-of-ai-razorpay-bengaluru-10-to-15-years-041126500123' },
    { title: 'Head of AI roles', url: 'https://www.naukri.com/head-of-ai-jobs-in-bangalore' },
    { title: 'Staff Engineer, Applied AI', url: 'https://jobs.ashbyhq.com/acme/1f2e3d' },
    { title: 'Careers at Acme', url: 'https://jobs.ashbyhq.com/acme' },
  ], 'FDE')
  assert.doesNotMatch(out, /q-forward|head-of-ai-jobs-in|Head of AI roles|Careers at Acme/)
  assert.match(out, /1\. \*Forward Deployed Engineer - Sarvam AI\*/); assert.match(out, /2\. \*Head of AI - Razorpay\*/); assert.match(out, /3\. \*Staff Engineer, Applied AI\*/)
  const src = readFileSync('lib/agent/places-search.ts', 'utf8')
  assert.match(src, /const phone = p\.phone && [^\n]+`\\n📞 \$\{p\.phone\.trim\(\)\}`/)
  const r = await import('../lib/bot/memory-redaction')
  for (const n of ['080 4123 4567', '098450 12345', '+91 98450 12345', '08041234567', '9845012345'])
    assert.equal(r.redactSecretShapedText(`1. *Green Trends*\n📞 ${n}`), `1. *Green Trends*\n📞 ${n}`, n)
  console.log('✓ job scan lists single postings only; salon listings show their phone and the filter keeps it')
}
console.log('Launch use-case checks passed')
