// P1-candidate shareable report citation privacy: TEST ONLY, EXPECTED SAFETY RED.
// Uses shipped redaction/presentation/SecondBrain visibility logic with inert synthetic URLs.
// No customer data, model, database, network, outbound operations, or production changes.
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-test-only'
process.env.OPENAI_API_KEY ||= 'synthetic-test-only'
process.env.ANTHROPIC_API_KEY ||= 'synthetic-test-only'

const { publicResearchUrl, researchReportText, artifactSections } =
  await import('../lib/agent/artifact-presentation.ts')
const { shareableSections } = await import('../lib/workspaces/rules.ts')

let controlsPass = 0
let safetyPass = 0
let safetyFail = 0
let controlsFail = 0
function check(title: string, safety: boolean, fn: () => void) {
  try {
    fn()
    if (safety) safetyPass++
    else controlsPass++
    console.log('PASS ' + (safety ? 'SAFETY' : 'CONTROL') + ': ' + title)
  } catch (error) {
    if (safety) safetyFail++
    else controlsFail++
    console.error('FAIL ' + (safety ? 'SAFETY' : 'CONTROL') + ': ' + title + ': ' + String(error))
  }
}

const publicUrl = 'https://research.example.test/guide?topic=houseplants'
const tokenUrl = 'https://research.example.test/guide?token=000000000000'
const passportUrl = 'https://research.example.test/guide?passport=R12345678'
const phoneUrl = 'https://research.example.test/guide?phone=919876543210'
const emailUrl = 'https://research.example.test/guide?email=synthetic.owner%40example.test'

function sharedReport(url: string): string {
  const sections = artifactSections({
    sections: [
      { title: 'Generated report', tool: 'artifact', result: {
        text: 'Public research. Original source: ' + url,
        sourceUrls: [url],
        synthesisStatus: 'generated',
      } },
      { title: 'Private input', tool: 'email', result: { text: 'Owner-only synthetic receipt.' } },
    ],
  })
  return shareableSections(sections).shown.map(s => s.text).join('\n')
}

check('ordinary public research citation remains readable', false, () => {
  assert.equal(publicResearchUrl(publicUrl), publicUrl)
  assert.match(researchReportText('Read ' + publicUrl, [publicUrl]), /topic=houseplants/)
  assert.match(sharedReport(publicUrl), /topic=houseplants/)
})
check('existing authenticated token query is denied and never exempted', false, () => {
  assert.equal(publicResearchUrl(tokenUrl), '')
  assert.doesNotMatch(researchReportText('Read ' + tokenUrl, [tokenUrl]), /000000000000/)
})
check('separately labeled owner-only email section remains withheld', false, () => {
  assert.doesNotMatch(sharedReport(publicUrl), /Owner-only synthetic receipt/)
})

check('passport-bearing URL must not be accepted as a public citation exemption', true, () => {
  assert.equal(publicResearchUrl(passportUrl), '')
})
check('phone and email-bearing URL queries must not be accepted as public citation exemptions', true, () => {
  assert.equal(publicResearchUrl(phoneUrl), '')
  assert.equal(publicResearchUrl(emailUrl), '')
})
check('passport-shaped identifier in a cited URL must not survive report redaction', true, () => {
  const rendered = researchReportText('Research source: ' + passportUrl, [passportUrl])
  assert.doesNotMatch(rendered, /R12345678/)
})
check('shareable artifact must not reinsert private query identifiers for other workspace viewers', true, () => {
  const rendered = sharedReport(passportUrl)
  assert.match(rendered, /Public research/)
  assert.doesNotMatch(rendered, /R12345678/)
  assert.doesNotMatch(rendered, /passport=R12345678/)
})
check('shared report citation must not carry a long owner phone in its URL query', true, () => {
  assert.doesNotMatch(sharedReport(phoneUrl), /919876543210/)
})

console.log(`RESULT controls_pass=${controlsPass} controls_fail=${controlsFail} safety_pass=${safetyPass} safety_fail=${safetyFail}`)
if (controlsFail || safetyFail) process.exitCode = 1
