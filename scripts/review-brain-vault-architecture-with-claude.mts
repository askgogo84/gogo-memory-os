import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const files = [
  'docs/architecture/BRAIN_VAULT_ARCHITECTURE_V1.md',
  'docs/architecture/BRAIN_VAULT_CONTRACTS_V1.md',
  'docs/architecture/BRAIN_VAULT_MIGRATION_V1.md',
  'docs/architecture/BRAIN_VAULT_E2E_MATRIX_V1.md',
]

const bundle = files.map(path => '\n\n===== ' + path + ' =====\n' + readFileSync(path, 'utf8')).join('')
const digest = createHash('sha256').update(bundle).digest('hex')
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey || apiKey.includes('placeholder')) {
  console.error('architecture_review_requires_real_anthropic_key')
  process.exit(2)
}

const anthropic = new Anthropic({ apiKey })
const prompt = [
  "You are the independent architecture review board for AskGogo.",
  "Review the attached Brain + Vault architecture adversarially.",
  "Your job is NOT to praise it or rewrite prose. Try to break it.",
  "Evaluate: context authority; mission restart safety; cross-surface concurrency; idempotency; approval replay/TOCTOU; Vault trust boundary; Secure Computer handoff continuity; provider/LLM outages; evidence semantics; watcher ordering; data model/migration hazards; privacy-safe observability; rollback compatibility; cost/latency; and E2E sufficiency.",
  "For every problem state severity BLOCKER/MAJOR/MINOR, exact failure scenario, violated invariant/contract, concrete architecture change, and regression test.",
  "Then produce sections: A Executive verdict REJECT/ACCEPT WITH CHANGES/ACCEPT; B Blockers; C Major issues; D Minor issues; E Missing invariants/contracts; F Missing E2E journeys; G Vault and approval security review; H Migration review; I Minimum-change patch list before implementation.",
  "Do not assume undocumented systems exist. If unspecified, call it out. Do not weaken approval, human-auth or terminal-evidence requirements. Do not request or output real credentials.",
  'Architecture bundle SHA256: ' + digest,
  bundle,
].join('\n')

const result = await anthropic.messages.create({
  model: process.env.ARCHITECTURE_REVIEW_MODEL || 'claude-sonnet-4-5',
  max_tokens: 7000,
  temperature: 0,
  messages: [{ role: 'user', content: prompt }],
})

const text = result.content.filter((item:any)=>item.type==='text').map((item:any)=>item.text).join('\n').trim()
if (!text) { console.error('architecture_review_empty'); process.exit(3) }

const output = '# Claude Independent Architecture Review\n\nArchitecture bundle SHA256: ' + digest + '\nModel: ' + (process.env.ARCHITECTURE_REVIEW_MODEL || 'claude-sonnet-4-5') + '\nGenerated: ' + new Date().toISOString() + '\n\n' + text + '\n'
console.log(output)

const writeIndex = process.argv.indexOf('--write')
if (writeIndex >= 0) {
  const target = process.argv[writeIndex + 1] || 'docs/architecture/CLAUDE_REVIEW_V1.md'
  writeFileSync(target, output, 'utf8')
  console.error('architecture_review_written:' + target)
}

if (/Executive verdict:\s*REJECT/i.test(text) || /^A\.\s*REJECT/im.test(text)) process.exitCode = 10
