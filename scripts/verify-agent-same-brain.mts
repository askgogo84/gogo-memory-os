import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sameBrain=readFileSync(new URL('../lib/agent/same-brain.ts',import.meta.url),'utf8')
const workspace=readFileSync(new URL('../lib/agent/google-workspace-read.ts',import.meta.url),'utf8')
const legacy=readFileSync(new URL('../lib/feature-intents-legacy.ts',import.meta.url),'utf8')

assert.match(sameBrain,/feature-intents-legacy/)
assert.doesNotMatch(sameBrain,/from ['"]@\/lib\/feature-intents['"]/)
assert.match(sameBrain,/routeLegacyFeatureIntent/)
assert.match(sameBrain,/processIncomingMessage/)
assert.match(legacy,/\/api\/todos/)
assert.match(legacy,/addToListDetailed/)
assert.match(legacy,/remind|reminder/i)

// Connected Workspace reads are deterministic and happen before the legacy/LLM
// path. The token stays inside the server-side helper; only bounded/redacted
// results come back to the planner step.
assert.match(sameBrain,/tryWorkspaceRead/)
assert.match(sameBrain,/searchWorkspaceEmails/)
assert.match(sameBrain,/searchWorkspaceContacts/)
assert.match(sameBrain,/searchWorkspaceDrive/)
assert.ok(sameBrain.indexOf('tryWorkspaceRead(params.actor,text)') < sameBrain.indexOf('routeLegacyFeatureIntent(params.actor.whatsappId'))
assert.match(sameBrain,/I won't guess which person you mean/)
assert.match(sameBrain,/I did not guess or fall back to another account/)

assert.match(workspace,/gmail_access_token,gmail_refresh_token/)
assert.match(workspace,/response\.status === 401/)
assert.match(workspace,/workspace_scope_required/)
assert.match(workspace,/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/)
assert.match(workspace,/people\.googleapis\.com\/v1\/people:searchContacts/)
assert.match(workspace,/www\.googleapis\.com\/drive\/v3\/files/)
assert.match(workspace,/MAX_FILE_TEXT = 60_000/)
assert.match(workspace,/redactSecretShapedText/)
assert.doesNotMatch(workspace,/console\.log\([^\n]*(?:gmail_access_token|refreshToken|Authorization)/)

// "Use the attached brief" must read the actual bounded attachment, never use a
// Gmail snippet as a substitute. Supported office/PDF/text formats are extracted
// server-side; multiple equally plausible attachments pause rather than guess.
assert.match(workspace,/MAX_ATTACHMENT_BYTES = 8 \* 1024 \* 1024/)
assert.match(workspace,/format=full/)
assert.match(workspace,/\/attachments\//)
assert.match(workspace,/readWorkspaceEmailBrief/)
assert.match(workspace,/pdf-parse/)
assert.match(workspace,/jszip/)
assert.match(workspace,/xlsx/)
assert.match(workspace,/status:'ambiguous'/)
assert.match(sameBrain,/readWorkspaceEmailBrief/)
assert.match(sameBrain,/no readable attachment matched the brief request/)
assert.match(sameBrain,/I won't guess which brief you mean/)
assert.match(sameBrain,/I did not substitute the email snippet for the document/)

console.log('✅ Agent planner dispatch uses bounded Workspace reads + real Gmail attachment briefs')
