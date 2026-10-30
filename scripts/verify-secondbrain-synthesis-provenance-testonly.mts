// P1-candidate SecondBrain synthesis privacy/provenance — TEST ONLY, EXPECTED SAFETY RED.
// This suite uses synthetic text and real shipped presentation/visibility helpers.
// No Supabase/network, provider, real identity, workspace sharing or side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-test-only'
process.env.OPENAI_API_KEY ||= 'synthetic-test-only'
process.env.ANTHROPIC_API_KEY ||= 'synthetic-test-only'

const { artifactSections } = await import('../lib/agent/artifact-presentation.ts')
const { shareableSections } = await import('../lib/workspaces/rules.ts')

type Section = { title: string; tool: string; result: { text: string; synthesisStatus?: string } }
let positive = 0
let safetyPass = 0
let safetyFail = 0
const problems: string[] = []
function check(name: string, safety: boolean, run: () => void) {
  try {
    run()
    if (safety) safetyPass++
    else positive++
    console.log(`PASS ${safety ? 'SAFETY' : 'CONTROL'}: ${name}`)
  } catch (err) {
    if (safety) safetyFail++
    else problems.push(`${name}: ${String(err)}`)
    console.error(`FAIL ${safety ? 'SAFETY' : 'CONTROL'}: ${name} — ${String(err)}`)
  }
}
function displayed(sections: Section[]): string {
  const parsed = artifactSections({ sections })
  return shareableSections(parsed).shown.map(section => section.text).join('\n')
}
const publicInfo: Section = { title: 'Public evidence', tool: 'web_search', result: { text: 'Public market data for synthetic company' } }
const publicReport: Section = { title: 'Public report', tool: 'artifact', result: { text: 'Public-only synthesis; no personal context.', synthesisStatus: 'generated' } }
const personalCalendar: Section = { title: 'Private calendar', tool: 'calendar', result: { text: 'Private synthetic calendar entry at Observatory 7:15pm' } }
const personalEmail: Section = { title: 'Private email', tool: 'email', result: { text: 'PRIVATE_INVOICE_CODE_8421 from a synthetic test receipt' } }

check('public-only synthesis and a public web citation remain shareable', false, () => {
  const out = displayed([publicReport, publicInfo])
  assert.match(out, /Public-only synthesis/)
  assert.match(out, /Public market data/)
})
check('separate calendar and email sections are withheld by the shipped viewer whitelist', false, () => {
  const out = displayed([publicReport, publicInfo, personalCalendar, personalEmail])
  assert.doesNotMatch(out, /Observatory 7:15pm|PRIVATE_INVOICE_CODE_8421/)
  assert.match(out, /Public-only synthesis/)
})
check('shipped producer passes owner context to synthesis and tags result as shareable artifact', false, () => {
  const producer = readFileSync('lib/agent/general-planner.ts', 'utf8')
  const rules = readFileSync('lib/workspaces/rules.ts', 'utf8')
  const page = readFileSync('app/dashboard/(app)/business/[ws]/shared/[id]/page.tsx', 'utf8')
  assert.match(producer, /OWNER_CONTEXT_CHECKED:\s*\$\{JSON\.stringify\(ownerContextForReport\(sections\)\)\}/)
  assert.match(producer, /sections\.unshift\(\{title:'Research report',tool:'artifact',result:\{text:reportText/)
  assert.match(rules, /SHAREABLE_SECTION_TOOLS\s*=\s*\['artifact', 'web_search'\]/)
  assert.match(page, /shareableSections\(artifactSections\(view\.contentJson\)\)/)
})
check('calendar-derived facts must not become visible through the generated artifact section', true, () => {
  // An LLM could legitimately include the owner context because the prompt says to use
  // calendar/travel for conflicts and timing. This is synthetic, NOT a real model output.
  const derivedReport: Section = { title: 'Research report', tool: 'artifact',
    result: { text: 'Public venue options. Avoid 7:15pm because your PRIVATE_VISIT_AT_OBSERVATORY is scheduled then.', synthesisStatus: 'generated' } }
  const out = displayed([derivedReport, personalCalendar, publicInfo])
  assert.match(out, /Public venue options/)
  assert.doesNotMatch(out, /PRIVATE_VISIT_AT_OBSERVATORY/, 'private calendar-derived detail crosses the viewer boundary')
})
check('email-derived facts must not become visible through the generated artifact section', true, () => {
  const derivedReport: Section = { title: 'Research report', tool: 'artifact',
    result: { text: 'Public subscription alternatives. Current private receipt: PRIVATE_INVOICE_CODE_8421.', synthesisStatus: 'generated' } }
  const out = displayed([derivedReport, personalEmail, publicInfo])
  assert.match(out, /Public subscription alternatives/)
  assert.doesNotMatch(out, /PRIVATE_INVOICE_CODE_8421/, 'private email-derived detail crosses the viewer boundary')
})

console.log(`RESULT controls_pass=${positive} safety_pass=${safetyPass} safety_fail=${safetyFail} control_fail=${problems.length}`)
if (problems.length || safetyFail) process.exitCode = 1
