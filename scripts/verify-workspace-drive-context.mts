import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper = readFileSync(new URL('../lib/agent/workspace-drive-context.ts', import.meta.url), 'utf8')
const readLayer = readFileSync(new URL('../lib/agent/google-workspace-read.ts', import.meta.url), 'utf8')
const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const google = readFileSync(new URL('../lib/services/google-gmail.ts', import.meta.url), 'utf8')

assert.match(google, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/, 'Workspace consent must include Drive read-only scope')
assert.match(readLayer, /export async function searchWorkspaceDrive/, 'Workspace read layer must expose Drive search')
assert.match(readLayer, /export async function readWorkspaceDriveText/, 'Workspace read layer must expose bounded Drive text reads')
assert.match(helper, /mutationsAllowed:false/, 'Drive context run metadata must declare that mutations are not allowed')
assert.match(helper, /safety:\{readOnly:true,mutationsAllowed:false,credentialsStored:false\}/, 'Drive artifact must preserve explicit read-only and credential safety metadata')
assert.match(helper, /source_refs:\[\{type:'google_drive_file'/, 'Drive artifact must carry file provenance')
assert.match(helper, /I did not pretend to read it/, 'Unsupported file types must fail transparently instead of fabricating document content')
assert.match(helper, /I found several plausible Drive files, so I stopped rather than choosing the wrong document/, 'Ambiguous Drive results must stop rather than guess')
assert.match(helper, /Answer the user's request using ONLY the supplied Google Drive document/, 'Document answers must remain grounded in the selected Drive file')
assert.match(helper, /No Drive file was changed/, 'User-facing result must state the read-only boundary')
assert.doesNotMatch(helper, /drive\/v3\/files[^`'"\n]*\{[^}]*method:\s*['"](?:POST|PATCH|PUT|DELETE)/i, 'Drive context mission must not introduce Drive write calls')
assert.match(runRoute, /tryRunWorkspaceDriveContext/, 'Agent run router must include the deterministic Drive context path')
assert.ok(runRoute.indexOf('tryRunWorkspaceDriveContext') < runRoute.indexOf('tryRunGeneralPlan({'), 'Drive context must route before open-ended general planning')

console.log('workspace Drive context regression: ok')
