// TEST-ONLY, EXPECTED RED on 29 Oct production: question-shaped action requests
// must not become false "completed" replies merely because the reply starts "Sure".
// Runs real lib/agent/brain.ts via tsx with a synthetic model client. No provider,
// customer data, credentials, network, real messages, bookings or payments.
// Scoped independent reproduction for issue #274, deployed #1087 review; DO NOT MERGE.
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-ci-placeholder'
process.env.OPENAI_API_KEY ||= 'synthetic-ci-placeholder'
process.env.ANTHROPIC_API_KEY ||= 'synthetic-ci-placeholder'

const brain = await import('../lib/agent/brain.ts')

type Outcome = { case: string; pass: boolean; detail?: string }
const results: Outcome[] = []
const check = async (label: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
    results.push({ case: label, pass: true })
    console.log('PASS ' + label)
  } catch (error: any) {
    const detail = String(error?.message || error).slice(0, 380)
    results.push({ case: label, pass: false, detail })
    console.error('FAIL ' + label + ': ' + detail)
  }
}
const decision = (request: string, reply: string) =>
  brain.decisionFromToolUse(request, 'reply', { text: reply })

// Positive controls protect the 29 Oct saved-state-answer behavior and prove
// that the test is executing the actual implementation, not a copied regex.
await check('control: factual saved-state checkout answer remains a reply', () => {
  assert.equal(decision(
    'When do I check out and is there a reminder for it?',
    'You check out on Sat, 31 Oct. A check-out reminder is set for 7:30 am that morning.',
  ).kind, 'reply')
})
await check('control: factual pre-existing reminder question remains a reply', () => {
  assert.equal(decision(
    'Is there already a reminder for my flight?',
    'There is an existing reminder for your flight at 7:30 am.',
  ).kind, 'reply')
})
await check('control: imperative reminder action claim is intercepted', () => {
  assert.deepEqual(decision(
    'Remind me to call the team tomorrow at 8 am.',
    "Done, I've set a reminder for 8 am.",
  ), { kind: 'handle', instruction: 'Remind me to call the team tomorrow at 8 am.', rewritten: false })
})
await check('control: question-shaped request with leading Done is intercepted', () => {
  assert.equal(decision(
    'Could you set a reminder for 7:30 am tomorrow?',
    "Done, I've set a reminder for 7:30 am tomorrow.",
  ).kind, 'handle')
})
await check('control: unrelated conversational answer remains a reply', () => {
  assert.equal(decision('Thanks!', 'Happy to help!').kind, 'reply')
})
await check('control: direct handle tool stays a handle', () => {
  assert.equal(brain.decisionFromToolUse(
    'Could you set a reminder for 7:30 am tomorrow?',
    'handle', { instruction: 'Could you set a reminder for 7:30 am tomorrow?', keep_original: true },
  ).kind, 'handle')
})

// Safety regressions: question marks are not evidence that the user merely
// requested a factual status lookup. Each request asks for a NEW side effect.
// A model-side success claim must be handled by the actual tool path.
await check('P1: Sure-prefix new reminder claim must route to handler', () => {
  assert.equal(decision(
    'Could you set a reminder for 7:30 am tomorrow?',
    "Sure, I've set a reminder for 7:30 am tomorrow.",
  ).kind, 'handle')
})
await check('P1: Absolutely-prefix new calendar claim must route to handler', () => {
  assert.equal(decision(
    'Can you add the investor call to my calendar?',
    "Absolutely, I've added that calendar event.",
  ).kind, 'handle')
})
await check('P1: Of-course-prefix new email claim must route to handler', () => {
  assert.equal(decision(
    'Would you send the project update email to the team?',
    "Of course, I've sent the email.",
  ).kind, 'handle')
})
await check('P1: Sure-prefix updated-hotel claim must route to handler', () => {
  assert.equal(decision(
    'Can you update my Mumbai hotel stay?',
    "Sure, I've updated your hotel stay.",
  ).kind, 'handle')
})
await check('P1: Sure-prefix cancellation claim must route to handler', () => {
  assert.equal(decision(
    'Could you cancel that reminder for me?',
    "Sure, I've canceled the reminder.",
  ).kind, 'handle')
})
await check('P1: synthetic LLM reply is not treated as completed action by decide()', async () => {
  const request = 'Could you set a reminder for 7:30 am tomorrow?'
  const reply = "Sure, I've set a reminder for 7:30 am tomorrow."
  const client: any = { messages: { create: async () => ({
    content: [{ type: 'tool_use', name: 'reply', input: { text: reply } }],
  }) } }
  const ctx = { turns: [], trackedFlights: [], sections: {}, name: null, timezone: 'Asia/Kolkata' }
  const out = await brain.decide({ text: request, ctx, client })
  assert.equal(out.kind, 'handle', 'model reply must not claim a completed action absent handler verification')
})

const failed = results.filter(r => !r.pass)
console.log('BRAIN_QUESTION_ACTION_CLAIMS_TESTONLY', JSON.stringify({
  pass: results.length - failed.length, failed: failed.map(f => f.case),
  source: 'lib/agent/brain.ts', provider: 'synthetic client only', mode: 'DO_NOT_MERGE_EXPECTED_RED',
}))
if (failed.length) process.exitCode = 1
