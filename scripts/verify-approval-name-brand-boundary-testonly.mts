/**
 * TEST ONLY / EXPECTED RED — DO NOT MERGE OR DEPLOY.
 * #274: shipped #1102 approval/quoted-evidence integrity regression.
 * Read-only static source and pure runtime transformations using synthetic text.
 *
 * No network, provider, user accounts, live sends, approvals or customer data.
 * Not registered in npm test; this focused workflow checks out literal PR HEAD.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { brandSafe, maskOutboundIdentifiers } from '../lib/security/outbound-identifiers'

type Rewriter = (text: string) => string | Promise<string>
let checks = 0
let passes = 0
let failures = 0

function runtime(source: string, filename: string): string {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
}

/** Execute the actual extracted route function, not a copied approximation. */
function routeRewriter(): Rewriter {
  const path = 'app/api/dashboard/chat/route.ts'
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'brandSafeResponse')
  assert.ok(fn, 'Expected shipped dashboard route brandSafeResponse function')
  const NextResponse = {
    json(payload: unknown, opts: { status?: number } = {}) {
      return { payload, status: opts.status }
    },
  }
  const callable = new Function('NextResponse', runtime(fn.getText(ast), 'route-safety.ts') + '\nreturn brandSafeResponse;')(NextResponse)
  assert.equal(typeof callable, 'function')
  return async text => {
    const sourceResponse = { status: 200, clone() { return { json: async () => ({ text, other: 'unchanged' }) } } }
    const result = await callable(sourceResponse)
    if (result === sourceResponse) return text
    assert.equal(result?.payload?.other, 'unchanged', 'route response metadata must survive')
    return String(result?.payload?.text)
  }
}

/** Execute the exact shipped UI helper function, extracted from TSX AST. */
function uiRewriter(): Rewriter {
  const path = 'components/dashboard/gogo-chat.tsx'
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const decl = ast.statements
    .filter(ts.isVariableStatement)
    .flatMap(node => Array.from(node.declarationList.declarations))
    .find(node => ts.isIdentifier(node.name) && node.name.text === 'brandSafe')
  assert.ok(decl?.initializer, 'Expected shipped dashboard UI brandSafe helper')
  const code = 'const brandSafe = ' + decl.initializer.getText(ast) + ';\n'
  const callable = new Function(runtime(code, 'ui-safety.tsx') + '\nreturn brandSafe;')()
  assert.equal(typeof callable, 'function')
  return text => String(callable(text))
}

async function check(label: string, runner: Rewriter, input: string, expected: string, category: 'control' | 'safety') {
  checks++
  try {
    const actual = await runner(input)
    assert.equal(actual, expected)
    passes++
    console.log('PASS [' + category + '] ' + label)
  } catch (err) {
    failures++
    console.error('FAIL [' + category + '] ' + label + ' — ' + (err instanceof Error ? err.message.slice(0, 250) : String(err).slice(0, 250)))
  }
}

const surfaces: Array<{ name: string; run: Rewriter }> = [
  { name: 'pure shipped brandSafe', run: brandSafe },
  { name: 'shipped dashboard route', run: routeRewriter() },
  { name: 'shipped chat-history UI', run: uiRewriter() },
]

const controls = [
  { label: 'explicit assistant self-identification', input: "I'm Claude, made by Anthropic.", expected: "I'm Gogo, made by our AI provider." },
  { label: 'external URL and email stay byte-exact', input: 'See https://claude.ai/artifact/example and support@anthropic.com', expected: 'See https://claude.ai/artifact/example and support@anthropic.com' },
  { label: 'other proper names unchanged', input: 'Claudette and Claudia', expected: 'Claudette and Claudia' },
  { label: 'ordinary Gogo reply unchanged', input: 'The assistant is Gogo.', expected: 'The assistant is Gogo.' },
]

const safety = [
  { label: 'approval text must preserve a real recipient name', input: 'Please confirm: remind Claude to submit the report. Reply YES', expected: 'Please confirm: remind Claude to submit the report. Reply YES' },
  { label: 'quoted attributed approval must remain factual', input: 'Quoted source: "Claude approved the payment."', expected: 'Quoted source: "Claude approved the payment."' },
  { label: 'factual model comparison must not become a false claim', input: 'Compare Claude Sonnet 4.5 with GPT.', expected: 'Compare Claude Sonnet 4.5 with GPT.' },
  { label: 'factual provider attribution must not be rewritten', input: 'Anthropic published a pricing update.', expected: 'Anthropic published a pricing update.' },
  { label: 'recipient-specific approval must keep intended target', input: 'Approve sending this document to Claude?', expected: 'Approve sending this document to Claude?' },
]

for (const surface of surfaces) {
  for (const c of controls) await check(surface.name + ': ' + c.label, surface.run, c.input, c.expected, 'control')
  for (const c of safety) await check(surface.name + ': ' + c.label, surface.run, c.input, c.expected, 'safety')
}

// WhatsApp/notification path uses maskOutboundIdentifiers(), which currently invokes brandSafe().
await check('outbound mask must retain approval recipient', maskOutboundIdentifiers,
  'Please confirm: remind Claude to submit the report. Reply YES',
  'Please confirm: remind Claude to submit the report. Reply YES', 'safety')
await check('outbound mask must retain factual source', maskOutboundIdentifiers,
  'The source states Anthropic published the update.',
  'The source states Anthropic published the update.', 'safety')

console.log('Approval integrity fake-only checks: ' + passes + '/' + checks + ' pass; ' + failures + ' fail.')
if (failures) process.exitCode = 1
