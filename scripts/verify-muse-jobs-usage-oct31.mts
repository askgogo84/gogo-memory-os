// 31 Oct, from r/MuseAgent: usage dashboards with weekly gauges and 7/30/60/90-day trends; a daily job scan with saved
// preferences; tracking applications from email; the right resume and a custom cover letter for each job.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const j = await import('../lib/agent/jobs')

// Preferences.
assert.equal(j.parseJobPrefsCommand('My job preferences: Head of AI or VP Engineering roles in Bengaluru or remote, above 80 LPA'), 'Head of AI or VP Engineering roles in Bengaluru or remote, above 80 LPA')
assert.equal(j.parseJobPrefsCommand("I'm looking for Forward Deployed Engineer roles in Bengaluru"), 'Forward Deployed Engineer roles in Bengaluru')
assert.equal(j.parseJobPrefsCommand('My job is stressful'), null)
const p = j.jobPrefsFrom('Head of AI or VP Engineering roles in Bengaluru or remote, above 80 LPA')
assert.deepEqual(p.roles, ['Head of AI', 'VP Engineering']); assert.deepEqual(p.locations, ['bengaluru', 'remote']); assert.equal(p.minSalaryLpa, 80)
assert.match(j.jobPrefsReply(p), /at least ₹80 LPA/)

// Daily radar.
assert.equal(j.isJobRadarRequest('Scan for new jobs every day and report the ones I would be qualified for'), true)
assert.equal(j.isJobRadarRequest('Find Forward Deployed Engineer jobs every day'), true)
assert.equal(j.isJobRadarRequest('find jobs'), false, 'a one-off search is not a daily radar')
assert.equal(j.jobRadarQuery('Scan for new jobs every day and report the ones I would be qualified for', p), 'Head of AI OR VP Engineering jobs bengaluru OR remote 80+ LPA')
assert.equal(j.jobRadarQuery('Find Forward Deployed Engineer jobs every day', null), 'Forward Deployed Engineer jobs')

// Application tracker.
const now = Date.parse('2026-10-31T06:00:00Z')
const rows = [
  { from: 'LinkedIn <jobs-noreply@linkedin.com>', subject: 'Your application was sent to Razorpay', snippet: 'You applied for Head of AI at Razorpay', at: now - 9 * 86400_000 },
  { from: 'Egon Zehnder <bangalore@egonzehnder.com>', subject: 'Re: Leadership search: Director / VP Engineering', snippet: 'Thank you for your interest. We would like to schedule a call next week', at: now - 2 * 86400_000 },
  { from: 'Stripe Recruiting <no-reply@stripe.com>', subject: 'Thanks for applying', snippet: 'Thank you for applying for the Staff Engineer role', at: now - 20 * 86400_000 },
  { from: 'Stripe Recruiting <no-reply@stripe.com>', subject: 'Update on your application', snippet: 'Unfortunately we have decided to move forward with other candidates for the Staff Engineer role', at: now - 5 * 86400_000 },
  { from: 'HDFC Bank <x@hdfcbank.com>', subject: 'Your loan application received', snippet: '', at: now },
].map(e => j.classifyApplicationEmail(e)).filter(Boolean) as any[]
const merged = j.mergeApplications(rows)
assert.deepEqual(merged.map((a: any) => `${a.company}|${a.role}|${a.status}`), ['Egon Zehnder||interview', 'Stripe|Staff Engineer|rejected', 'Razorpay|Head of AI|applied'])
const text = j.formatApplications(merged, now)
assert.match(text, /Your job applications\* \(3, 2 still open\)/); assert.match(text, /🗓️ Interview · 2 days ago/); assert.match(text, /✖️ Not moving forward/)
assert.equal(j.isJobApplicationsQuery('show my job applications'), true)
assert.equal(j.isJobApplicationsQuery('What jobs have I applied for?'), true)
assert.equal(j.isJobApplicationsQuery('show my visa application'), false)

// Prepare an application: the matching resume, never a submit.
assert.deepEqual(j.parsePrepareApplication('Prepare application for Head of AI at Razorpay https://jobs.lever.co/razorpay/123'), { job: 'Head of AI at Razorpay https://jobs.lever.co/razorpay/123' })
assert.equal(j.parsePrepareApplication('Write a cover letter for Staff Engineer at Stripe')?.job, 'Staff Engineer at Stripe')
assert.equal(j.pickResume([{ title: 'Resume - Engineering leadership', summary: 'VP Engineering, infrastructure' }, { title: 'Resume - AI product', summary: 'Head of AI, LLM products, agents' }], 'Head of AI at Razorpay').title, 'Resume - AI product')
const cmd = readFileSync('lib/agent/jobs-command.ts', 'utf8')
assert.match(cmd, /I haven't applied\. Submit it yourself/); assert.doesNotMatch(cmd, /tryRunGeneralPlan|secure browser/i, 'preparing never starts a browser submit')
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /m\.isJobCommand\(p\.text\)/)
console.log('✓ job preferences, a daily job radar, applications tracked from email, the right resume and a cover letter')

// Usage trends.
const act = await import('../lib/dashboard/activity')
const t0 = Date.parse('2026-10-31T06:00:00Z') // Saturday
const iso = (d: number) => new Date(t0 - d * 86400_000).toISOString()
const tr = act.buildActivityTrends({
  aiEvents: [{ created_at: iso(0), action: 'chat' }, { created_at: iso(1), action: 'web_search' }, { created_at: iso(10), action: 'chat' }, { created_at: iso(45), action: 'chat' }, { created_at: iso(80), action: 'expense' }],
  reminders: [{ remind_at: iso(2) }, { remind_at: iso(40) }],
  runs: [{ created_at: iso(3), status: 'completed', title: 'Grocery list and reminder' }, { created_at: iso(3), status: 'failed', title: 'Browser · x' }],
  alerts: [{ created_at: iso(1) }],
}, t0, 40)
assert.deepEqual(tr.trends.map(x => [x.days, x.ai, x.tasks, x.reminders, x.alerts]), [[7, 2, 1, 1, 1], [30, 3, 1, 1, 1], [60, 4, 1, 2, 1], [90, 5, 1, 2, 1]])
assert.equal(tr.weekLimit, 280); assert.equal(tr.weekStart, '2026-10-25T18:30:00.000Z', 'the week starts Monday 00:00 IST')
assert.equal(tr.weekUsed, 2); assert.equal(tr.weeks.length, 12); assert.equal(tr.weeks[11].ai, 2)
assert.equal(tr.topActions[0].action, 'Questions answered')
assert.match(act.formatActivityTrends(tr, 'Free'), /This week:\* 2 of 280 AI actions \(1%\) · resets Monday/)
assert.equal(act.isUsageQuery('show my usage'), true); assert.equal(act.isUsageQuery('how many tasks have you done for me this week'), true); assert.equal(act.isUsageQuery('show my expenses'), false)
const pm = await import('../lib/bot/process-message')
assert.equal(pm.isUsageCommand('show my usage'), true); assert.equal(pm.isUsageCommand('How many tasks have you done for me?'), true)
assert.match(readFileSync('app/dashboard/(app)/usage/page.tsx', 'utf8'), /<UsageTrends a=\{trends\} \/>/)
console.log('✓ usage: this week against the weekly allowance, 7/30/60/90-day trends, 12 weeks, top uses, recent tasks')
