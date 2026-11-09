// 26 Oct live (run 7a8fcf22): a Swiggy menu read for a food comparison used the saved Swiggy login and stopped at a
// text code ("vault_login:done", authReason otp). Comparison reads are public pages and never sign in.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const cmd = read('lib/agent/browser-command.ts'), sc = read('lib/agent/secure-computer.ts')
assert.match(cmd, /\.\.\.\(runMetadata\.comparison_parent_id&&params\.mode==='read'\?\{publicOnly:true\}:\{\}\)/, 'comparison reads pass publicOnly')
assert.match(sc, /readDeadline\?:number;publicOnly\?:boolean\}\):Promise<SecureBrowserResult>/)
assert.match(sc, /if\(params\.publicOnly\)signedOutEntry=false/, 'a header Sign in link never starts a login on a public read')
assert.match(sc, /if\(!params\.publicOnly&&!params\.resumePage&&!params\.loginCode&&!signedOutEntry/, 'the phone-site sign-in at start is skipped')
assert.match(sc, /if\(!params\.publicOnly && !vaultAttempted && params\.accountCreation!==true/, 'no saved login is used on a public read')
// A real sign-in wall still pauses for the person (the auth gate after the vault block is unchanged).
assert.match(sc, /if\(!signupPasswordField&&!bookingLoginStep&&\(authGate\.required\|\|pageLooksLikeLogin\(page\)\)\)\{/)
console.log('Comparison reads never sign in passed')
