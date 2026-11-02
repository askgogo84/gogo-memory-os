// Source-connected synthetic SecondBrain workspace-sharing privacy regression.
// All test facts are fictional. No network, database, provider, user data or real sharing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function originalModule(path, mocks = {}) {
  const source = readFileSync(path, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText
  const module = { exports: {} }
  const context = {
    module, exports: module.exports,
    require(specifier) {
      if (!Object.prototype.hasOwnProperty.call(mocks, specifier))
        throw new Error('Unexpected dependency: ' + specifier)
      return mocks[specifier]
    },
    URL, URLSearchParams, Date, Buffer, console,
  }
  vm.runInNewContext(compiled, context, { filename: path, timeout: 2000 })
  return module.exports
}

const redaction = originalModule('lib/bot/memory-redaction.ts')
const presentation = originalModule('lib/agent/artifact-presentation.ts', {
  './google-workspace-read': { formatEmailSnippet: value => String(value) },
  '@/lib/bot/memory-redaction': redaction,
})
const rules = originalModule('lib/workspaces/rules.ts')
const plannerSource = readFileSync('lib/agent/general-planner.ts', 'utf8')
const sharedPage = readFileSync('app/dashboard/(app)/business/[ws]/shared/[id]/page.tsx', 'utf8')
const publicUrl = 'https://public-research.example.test/source'

function section(tool, value, options = {}) {
  const { editedBy, status, ...rest } = options
  return {
    title: tool === 'artifact' ? 'Research report' : tool,
    tool,
    ...(editedBy === undefined ? {} : { editedBy }),
    result: {
      text: value,
      ...(tool === 'artifact' ? { synthesisStatus: status || 'generated', sourceUrls: [publicUrl] } : {}),
      ...rest,
    },
  }
}
function workspaceView(sections) {
  // Exact source modules and composition used in the shared viewer.
  return rules.shareableSections(presentation.artifactSections({ sections }))
}
let goodControls = 0
let badControls = 0
let goodMandatory = 0
let badMandatory = 0
function check(kind, title, fn) {
  try {
    fn()
    if (kind === 'control') goodControls++
    else goodMandatory++
    console.log('PASS ' + kind.toUpperCase() + ': ' + title)
  } catch (error) {
    if (kind === 'control') badControls++
    else badMandatory++
    console.error('FAIL ' + kind.toUpperCase() + ': ' + title + ' — ' + (error?.message || String(error)))
  }
}

check('control', 'real planner passes owner-private context to saved report synthesis', () => {
  assert.match(plannerSource, /OWNER_CONTEXT_CHECKED:\\s*\\$\\{JSON\\.stringify\\(ownerContextForReport\\(sections\\)\\)\\}/)
  assert.match(plannerSource, /sections\\.unshift\\(\\{title:'Research report',tool:'artifact'/)
})
check('control', 'shared page uses membership-bound artifact read and shared filter', () => {
  assert.match(sharedPage, /getSharedArtifact\\(String\\(session\\.telegramId\\), ws, id\\)/)
  assert.match(sharedPage, /shareableSections\\(artifactSections\\(view\\.contentJson\\)\\)/)
})
check('control', 'public web result remains visible to workspace members', () => {
  const view = workspaceView([section('web_search', 'Public commuter train timetable.', {sourceUrls:[publicUrl]})])
  assert.equal(view.shown.length, 1)
  assert.equal(view.shown[0].tool, 'web_search')
  assert.match(view.shown[0].text, /Public commuter/)
})
check('control', 'owner-rewritten full report section remains visible after deliberate edit', () => {
  const view = workspaceView([section('artifact', 'Owner-authored public research announcement.', { editedBy: 'owner' })])
  assert.equal(view.shown.length, 1)
  assert.equal(view.shown[0].edited, true)
  assert.match(view.shown[0].text, /Owner-authored/)
})
check('control', 'direct personal tool results remain hidden', () => {
  const view = workspaceView(['calendar', 'travel', 'memory', 'gmail'].map(tool => section(tool, 'Owner-only detail.')))
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 4)
})
check('control', 'original generated report remains readable in owner-private presentation', () => {
  const ownerSections = presentation.artifactSections({ sections: [section('artifact', 'Owner-only synthesized context.') ] })
  assert.equal(ownerSections.length, 1)
  assert.match(ownerSections[0].text, /Owner-only synthesized/)
})

const privateFacts = [
  ['calendar', 'Owner has an unreleased meeting in the garden on Friday.'],
  ['travel', 'Owner plans a private stop at Port Meridian after the conference.'],
  ['memory', 'Owner is privately considering a confidential supplier transfer.'],
  ['gmail', 'Owner email discusses a quiet, unannounced hiring change.'],
]
for (const [tool, privateFact] of privateFacts) {
  check('mandatory', 'generated artifact cannot echo private ' + tool + ' facts to workspace viewer', () => {
    assert.equal(redaction.redactSecretShapedText(privateFact), privateFact)
    const view = workspaceView([
      section('artifact', 'Public market summary. ' + privateFact),
      section('web_search', 'Public research citation only.', { sourceUrls: [publicUrl] }),
      section(tool, privateFact),
    ])
    assert.equal(view.shown.length, 1)
    assert.equal(view.shown[0].tool, 'web_search')
    assert.equal(view.withheld, 2)
    assert.ok(!view.shown.some(s => s.text.includes(privateFact)))
  })
}
check('mandatory', 'benign generated artifact with no provenance remains private by default', () => {
  const view = workspaceView([section('artifact', 'Innocent public-looking text.')])
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 1)
})
check('mandatory', 'legacy artifact without generated metadata remains private', () => {
  const view = workspaceView([{title:'Old report',tool:'artifact',result:{text:'Legacy model-generated details.'}}])
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 1)
})
check('mandatory', 'fake synthesis public status does not confer release approval', () => {
  const view = workspaceView([section('artifact', 'Unverified model claims.', { status: 'public' })])
  assert.equal(view.shown.length, 0)
})
check('mandatory', 'model-labelled artifact cannot impersonate owner edit', () => {
  const view = workspaceView([section('artifact', 'Unreviewed model text.', { editedBy: 'gogo' })])
  assert.equal(view.shown.length, 0)
})
check('mandatory', 'missing or stringified edited flag cannot bypass lower-level rule', () => {
  const view = rules.shareableSections([
    {tool:'artifact'}, {tool:'artifact', edited:'true'}, {tool:'artifact', edited:1},
    {tool:'artifact', edited:false}, {tool:'memory', edited:true},
  ])
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 5)
})
check('mandatory', 'mixed generated and deliberately owner-rewritten sections show only reviewed text', () => {
  const view = workspaceView([
    section('artifact', 'Unapproved automatic meeting summary.'),
    section('artifact', 'Owner wrote this public summary personally.', { editedBy: 'owner' }),
    section('web_search', 'Public web citation.'),
  ])
  assert.deepEqual(Array.from(view.shown, s => s.tool), ['artifact','web_search'])
  assert.ok(!view.shown.some(s => s.text.includes('Unapproved')))
  assert.equal(view.withheld, 1)
})

check('mandatory', 'owner title-or-notes edit cannot declassify untouched generated sections', () => {
  const view = rules.shareableSections(presentation.artifactSections({
    editedBy: 'owner', // top-level metadata can change when only a title/notes are edited
    sections: [section('artifact', 'Generated and unreviewed owner-private text.')],
  }))
  assert.equal(view.shown.length, 0)
  assert.equal(view.withheld, 1)
})

console.log('SUMMARY control=' + goodControls + '/6 controlFail=' + badControls +
  ' mandatory=' + goodMandatory + '/11 mandatoryFail=' + badMandatory + ' synthetic=true')
if (badControls || badMandatory) process.exitCode = 1
