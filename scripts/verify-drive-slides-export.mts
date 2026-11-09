// 2 Nov live: "summarise the latest document in my Google Drive" picked a Google Slides deck and answered
// "this Drive file could not be safely extracted". Slides export to plain text through the same Drive export call
// as Docs; Sheets keep CSV; anything else still says it cannot be read rather than guessing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = readFileSync('lib/agent/google-workspace-read.ts', 'utf8')
const fn = src.slice(src.indexOf('export async function readWorkspaceDriveText'), src.indexOf('export async function readWorkspaceDriveText') + 1600)
const plainBranch = fn.match(/if\(([^)]*)\)\s*\{\s*content=await workspaceText\(actor,`[^`]*export\?mimeType=\$\{encodeURIComponent\('text\/plain'\)\}/)
assert.ok(plainBranch, 'a plain-text export branch exists')
assert.match(plainBranch![1], /application\/vnd\.google-apps\.document/)
assert.match(plainBranch![1], /application\/vnd\.google-apps\.presentation/, 'Google Slides use the plain-text export')
assert.match(fn, /google-apps\.spreadsheet'\)\s*\{\s*content=await workspaceText\(actor,`[^`]*text\/csv/, 'Sheets still export as CSV')
assert.match(fn, /return \{supported:false/, 'unknown formats are still refused, never guessed')
assert.doesNotMatch(fn, /method:\s*'(?:POST|PATCH|PUT|DELETE)'/, 'read-only')
console.log('✓ Google Slides read as plain text; Sheets as CSV; unknown formats refused; read-only')
console.log('Drive Slides export checks passed')
