// TEST ONLY: source-connected, wholly synthetic SecondBrain shared generated-report privacy regression.
// Intentionally RED on the unmodified 31 Oct 2026 implementation. NEVER merge/deploy this diagnostic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute shipped TypeScript source rather than a reimplementation of its functions.
// Only network-dependent helpers are substituted; the real memory redactor is loaded.
function originalModule(path, mocks = {}) {
  const source = readFileSync(path, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (!Object.prototype.hasOwnProperty.call(mocks, specifier)) {
        throw new Error('Unexpected dependency in inert fixture: ' + specifier)
      }
      return mocks[specifier]
    },
    URL, URLSearchParams, Date, Buffer, console,
  }
  vm.runInNewContext(js, context, { filename: path, timeout: 2000 })
  return module.exports
}

const redaction = originalModule('lib/bot/memory-redaction.ts')
const presenter = originalModule('lib/agent/artifact-presentation.ts', {
  './google-workspace-read': { formatEmailSnippet: text => String(text) },
  '@/lib/bot/memory-redaction': redaction,
})
const rules = originalModule('lib/workspaces/rules.ts')
const plannerSource = readFileSync('lib/agent/general-planner.ts', 'utf8')
const sharedPageSource = readFileSync('app/dashboard/(app)/business/[ws]/shared/[id]/page.tsx', 'utf8')
const publicUrl = 'https://public-research.example.test/safe-source'

function rendered(sections) {
  // Same critical sequence the actual shared report page invokes.
  return rules.shareableSections(presenter.artifactSections({ sections }))
}

function section(tool, text, extras = {}) {
  return {
    title: tool === 'artifact' ? 'Research report' : tool,
    tool,
    result: { text, ...extras },
  }
}

let controls = 0
let controlFailures = 0
let safetyPasses = 0
let safetyFailures = 0
function check(kind, name, fn) {
  try {
    fn()
    if (kind === 'control') controls++
    else safetyPasses++
    console.log('PASS ' + kind.toUpperCase() + ': ' + name)
  } catch (error) {
    if (kind === 'control') controlFailures++
    else safetyFailures++
    console.error('FAIL ' + kind.toUpperCase() + ': ' + name + ' — ' + (error?.message || String(error)))
  }
}

check('control', 'original planner actually injects private owner context into synthesis input', () => {
  assert.match(plannerSource, /OWNER_CONTEXT_CHECKED:\s*\$\{JSON\.stringify\(ownerContextForReport\(sections\)\)\}/)
  assert.match(plannerSource, /sections\.unshift\(\{title:'Research report',tool:'artifact'/)
  assert.match(plannerSource, /ownerContextForReport\([^)]*\)[\s\S]*?section\.tool/)
})
check('control', 'actual workspace view performs membership-bound lookup and shares presenter output', () => {
  assert.match(sharedPageSource, /getSharedArtifact\(String\(session\.telegramId\), ws, id\)/)
  assert.match(sharedPageSource, /shareableSections\(artifactSections\(view\.contentJson\)\)/)
})
check('control', 'public web source and public generated report stay readable', () => {
  const view = rendered([
    section('artifact', 'Public transport research from a published public source.', { synthesisStatus: 'generated', sourceUrls: [publicUrl] }),
    section('web_search', 'Public source lists a weekday bus.', { sourceUrls: [publicUrl] }),
  ])
  assert.equal(view.shown.length, 2)
  assert.equal(view.withheld, 0)
  assert.ok(view.shown.some(item => item.text.includes('Public transport research')))
  assert.ok(view.shown.some(item => item.text.includes('weekday bus')))
})
check('control', 'direct personal tool sections are withheld', () => {
  const view = rendered([
    section('calendar', 'Owner calendar meeting'),
    section('travel', 'Owner travel itinerary'),
    section('memory', 'Owner private preference'),
    section('gmail', 'Owner private email'),
  ])
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 4)
})
check('control', 'deliberate owner-edited public report stays readable', () => {
  const view = rendered([{
    ...section('artifact', 'Owner-approved public announcement for the team.', { sourceUrls: [publicUrl] }),
    editedBy: 'owner',
  }])
  assert.equal(view.shown.length, 1)
  assert.equal(view.shown[0].edited, true)
  assert.match(view.shown[0].text, /Owner-approved public announcement/)
})
check('control', 'real secret-shaped redaction still protects identifiers', () => {
  assert.doesNotMatch(redaction.redactSecretShapedText('passport number: 123456789012'), /123456789012/)
})

// Safety assertions: a raw private section is withheld, but the SAME private
// fact echoed by a model-generated artifact is currently allowlisted by tool.
// Synthetic facts deliberately contain no identity numbers, real PII or secrets.
// Fix should use provenance-aware public-share presentation or explicit owner
// release approval, not a keyword blacklist, not relaxing the membership gate.
const privateCases = [
  ['calendar', 'Owner calendar has an unreleased strategy meeting in the garden on Monday evening.'],
  ['travel', 'Owner travel plans include a private stop in Port Meridian after the public conference.'],
  ['memory', 'Owner memory says they are privately considering a confidential project transfer.'],
  ['email', 'Owner private email says an unannounced supplier change is being negotiated.'],
]
for (const [tool, privateFact] of privateCases) {
  check('safety', 'generated artifact must not echo private ' + tool + ' fact to workspace viewer', () => {
    // Report synthesis is permitted to read the owner context, by planner design.
    assert.equal(redaction.redactSecretShapedText(privateFact), privateFact, 'fixture is not a secret-shaped identifier')
    const view = rendered([
      section('artifact', 'Public research finding. ' + privateFact, {
        synthesisStatus: 'generated', sourceUrls: [publicUrl],
      }),
      section('web_search', 'This is a public market excerpt.', { sourceUrls: [publicUrl] }),
      section(tool, privateFact),
    ])
    assert.equal(view.withheld, 1, 'direct private source must stay withheld')
    assert.ok(view.shown.some(item => item.tool === 'web_search'), 'public citation should remain')
    assert.ok(!view.shown.some(item => item.text.includes(privateFact)),
      'a private fact was echoed in a supposedly safe generated artifact')
  })
}

console.log('SUMMARY: controls ' + controls + '/6 pass, control failures ' + controlFailures +
  '; privacy safety ' + safetyPasses + '/4 pass, mandatory safety failures ' + safetyFailures)
if (controlFailures) {
  console.error('FIXTURE/CONTROL FAILURE — result invalid; investigate before interpreting safety')
  process.exitCode = 2
} else if (safetyFailures) {
  console.error('EXPECTED PRIVACY SAFETY RED — production behavior unchanged; DO NOT MERGE/DEPLOY')
  process.exitCode = 1
} else {
  console.log('Synthetic generated-report privacy assertions green; independent review and hosted acceptance still required')
}
