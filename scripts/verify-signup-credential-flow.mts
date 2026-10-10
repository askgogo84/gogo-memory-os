// Generated sign-up passwords in the secure browser. The planner names the new-password field
// only (fill_secret); the backend generates the password and records it as pending BEFORE
// anything is submitted; the worker fills it from a command-scoped variable, only into a real
// password input; a verified creation commits it to the Vault, an existing account discards it,
// and anything unclear leaves it pending. Structural checks of production source. The worker was
// also run locally against a sign-up page (password delivered, absent from worker output; wrong
// field or missing variable refused with no submit).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('lib/agent/secure-computer.ts', 'utf8')
const flow = readFileSync('lib/vault/signup-credential.ts', 'utf8')
const command = readFileSync('lib/agent/browser-command.ts', 'utf8')

// Action type and normaliser: only an authorised execution may carry fill_secret, with no value.
assert.match(src, /\| \{ kind:'fill_secret'; selector:string \}/, 'fill_secret carries a selector and no value')
assert.match(src, /else if\(kind==='fill_secret'\)\{\s*\/\/[^\n]*\n\s*if\(!allowSubmit\)continue/, 'fill_secret is dropped unless the plan may authorise a consequential action')

// Worker: execute only, from the command-scoped variable, only into a password input, and a
// failed fill stops the wave so nothing is submitted without the password.
const worker = src.slice(src.indexOf("else if(a.kind==='fill_secret'){"), src.indexOf("else if(a.kind==='search_enter'){", src.indexOf("else if(a.kind==='fill_secret'){")))
assert.match(worker, /if\(payload\.mode!=='execute'\)/, 'the worker fills a generated password only in execute mode')
assert.match(worker, /process\.env\.GOGO_SIGNUP_SECRET/, 'the password comes from the command-scoped variable')
assert.match(worker, /el\.tagName==='INPUT'&&String\(el\.getAttribute\('type'\)\|\|''\)\.toLowerCase\(\)==='password'/, 'only a real password input is filled')
assert.doesNotMatch(worker, /log\.push\([^)]*signupSecret/, 'the password is never logged')
assert.match(src, /if\(a\.kind==='fill_secret'\)break;/, 'a failed password fill stops the wave before any submit')

// Host: the pending record is written before the execution starts, only for account_creation,
// for at most two fields, and a store failure stops the run.
const pendingAt = src.indexOf('signup=await beginSignupCredential(')
const startAt = src.indexOf("if(params.mode==='execute')executionStarted=true")
assert.ok(pendingAt > 0 && startAt > pendingAt, 'the pending record is written before execution starts')
assert.match(src, /approvedOperation!=='account_creation'\)throw new Error\('signup_secret_not_authorised'\)/, 'only an account_creation run may fill a generated password')
assert.match(src, /\.length>2\)throw new Error\('signup_secret_too_many_fields'\)/, 'at most a password and its confirmation')
assert.match(src, /throw new Error\(`signup_pending_unavailable:/, 'no pending record means no sign-up')
assert.match(src, /signupEnv=\{GOGO_SIGNUP_SECRET:signup\.secret\}/, 'the password is passed only as a command-scoped variable')

// Resolution: created commits, an existing account discards, anything else stays pending.
assert.match(src, /if\(signup\)signupVault=await resolveSignupCredential\(signup,accountExists\?'rejected':'created'\)/, 'verified outcomes resolve the pending record')
assert.match(src, /if\(signup&&!signupVault\)console\.error\('SIGNUP_PENDING_UNRESOLVED:',JSON\.stringify\(\{pendingId:signup\.pendingId\}\)\)/, 'an unresolved password stays pending and is logged by id only')
assert.match(flow, /if \(outcome === 'unknown'\) return 'pending'/, 'an unclear outcome never discards the password')
assert.match(flow, /await markPendingSignupCommitted\([\s\S]*return 'saved'/, 'the pending record is marked committed only after the Vault save')
assert.doesNotMatch(flow, /console\.[a-z]+\([^\n]*\bsecret\b/, 'no log line includes the password')

// Username comes from the request, never from the provider page.
const usernameFn = flow.slice(flow.indexOf('export function signupUsernameFromObjective'), flow.indexOf('export type BegunSignup'))
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
assert.match(usernameFn, /String\(objective \|\| ''\)\.match\(EMAIL\)/, 'the username is taken from the authority source')
assert.equal('Create a Hugging Face account for Goverdhan@Tipplr.in'.match(EMAIL)?.[0].toLowerCase(), 'goverdhan@tipplr.in')

// Planner is told about fill_secret only in execute mode, and the run id reaches the browser.
assert.match(src, /\$\{mode==='execute'\?'Only for approvedOperation account_creation: [^']*fill_secret/, 'the planner learns fill_secret only in execute mode')
assert.match(command, /runSecureBrowser\(\{[^)]*runId:params\.runId/, 'the run id is passed so the pending record is tied to the run')

console.log('Sign-up credential flow: fill_secret gating, pending-before-submit, resolution and no-leak checks passed (structural)')
