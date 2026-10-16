import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 16 Oct: a saved phone login asks the site for a text code, then Gogo asks the person for it in chat or on WhatsApp,
// types it into the same open page, and carries on with the question. The code is used once and never stored or
// logged. Run: npx tsx scripts/verify-login-code-flow.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const { loginCodeMessage } = await import('../lib/agent/browser-command')
const { otpReply } = await import('../lib/agent/provider-booking')

const ask = loginCodeMessage({ site: 'swiggy.com', takeoverUrl: 'https://app.askgogo.in/dashboard/activity/r1/browser' })
assert.match(ask, /^swiggy\.com sent a sign-in code to your phone\./)
assert.match(ask, /Reply here with just the code, for example \*482913\*\. I'll type it in and carry on with your question\. I use it once and never save it\./)
assert.match(loginCodeMessage({ site: 'swiggy.com', rejected: true, takeoverUrl: 'u' }), /didn't accept that code\. Send me the newest code/)
assert.match(loginCodeMessage({ site: 'swiggy.com', tooMany: true, takeoverUrl: 'u' }), /three times, so I stopped there\. Open this, tap Take control/)
assert.equal(otpReply('482913'), '482913')
assert.equal(otpReply('code is 4829 13'), '482913')
assert.equal(otpReply('where is my order'), null)

const sc = read('lib/agent/secure-computer.ts')
// The browser side: stop for the code after the saved number asked for one; use the code once on the code screen.
assert.match(sc, /if\(vaultFill\.phoneCode&&vaultFill\.codeRequested\)\{vaultPhoneCodeRequested=true;/)
assert.match(sc, /if\(vaultPhoneCodeRequested&&!params\.loginCode&&!providerBooking\)return await codeStop\(false\)/)
assert.match(sc, /if\(params\.loginCode&&!loginCodeUsed&&!providerBooking&&\(wave===0\|\|bookingOtpPrompt\(page\)\|\|detectHumanAuthGate\(page\)\.reason==='otp'\)\)\{\n\s+loginCodeUsed=true/)
assert.match(sc, /if\(!entered\|\|stillCode\)return await codeStop\(entered\)/, 'a refused code asks again')
assert.match(sc, /env:\{GOGO_LOGIN_CODE:params\.code,/, 'the code is a command-scoped variable only')
const script = sc.slice(sc.indexOf('const VAULT_CODE_SCRIPT'), sc.indexOf('// The field name shown beside a picker'))
assert.doesNotMatch(script, /console\.(?:log|error)\([^)]*code\b[^)]*\)(?![^\n]*JSON\.stringify\(out\))/, 'the script never prints the code')
assert.doesNotMatch(script, /page\.goto/, 'the code goes into the page Gogo left open, never a fresh load')
assert.doesNotMatch(script, /\b(?:Pay|Place order|Buy now)\b/, 'never presses a pay control')
assert.match(sc, /console\.log\('VAULT_LOGIN_CODE:',JSON\.stringify\(\{entered,submitted:Boolean\(page\?\.vaultCode\?\.submitted\),outcome:codeOutcome,stillCode,/)
// 16 Oct live: the code went in and Verify was pressed, yet leftover code wording kept Gogo stopped.
assert.match(sc, /const stillCode=codeOutcome==='accepted'\?false:codeOutcome==='rejected'\?true:/)
assert.match(sc, /outcome='accepted'; break;/)
assert.match(sc, /outcome='rejected'; errorCue=line\.replace\(\/\\d\/g,'#'\)/)
assert.match(sc, /if\(loginCodeAccepted&&authGate\.reason==='otp'\)authGate=/)
assert.match(sc, /if\(loginCodeAccepted&&finalAuthGate\.reason==='otp'\)finalAuthGate=/)

const bc = read('lib/agent/browser-command.ts')
assert.match(bc, /const persistentAccountSession=accountCreation\|\|providerBooking\|\|vaultAccountRead/, 'the page stays open for the code')
assert.match(bc, /login_code:tooMany\?null:\{requested_at:new Date\(\)\.toISOString\(\),attempts\}/)
assert.match(bc, /\.eq\('metadata_json->login_code->>requested_at',String\(requested\)\)/, 'a code is claimed once')
assert.match(bc, /Date\.now\(\)-requested>10\*60_000/, 'codes are accepted for 10 minutes')

const dash = read('app/api/dashboard/chat/route.ts')
assert.ok(dash.indexOf('const loginCode = otpReply(text)') < dash.indexOf('handleInboxReplyRead({actor,text})'), 'checked before any handler or model')
assert.match(dash, /saveConversation\(user\.telegram_id, '\[sign-in code sent\]', reply\)/, 'the code is never saved to the conversation')
const wa = read('app/api/webhooks/whatsapp/route.ts')
assert.match(wa, /const trigger = await triggerLoginCodeResume\(codeRunId, bookingCode\)/)
assert.match(wa, /saveConversation\(resolvedUser\.telegramId, 'user', '\[sign-in code sent\]'\)/)
assert.match(read('app/api/agent/approved-browser/route.ts'), /runLoginCodeResume\(runId, loginCode\)/)
console.log('verify-login-code-flow: ok')

// 16 Oct (his ask): sites that sign in with a mobile number use the WhatsApp number Gogo already has. No Connect page.
const { phoneLoginProviderForDomain } = await import('../lib/vault/providers')
assert.equal(phoneLoginProviderForDomain('www.swiggy.com')?.key, 'swiggy')
assert.equal(phoneLoginProviderForDomain('www.amazon.in')?.key, 'amazon')
assert.equal(phoneLoginProviderForDomain('www.flipkart.com')?.key, 'flipkart')
assert.equal(phoneLoginProviderForDomain('www.irctc.co.in'), null, 'IRCTC signs in with a user ID')
assert.equal(phoneLoginProviderForDomain('www.booking.com'), null)
assert.match(loginCodeMessage({ site: 'swiggy.com', takeoverUrl: 'u', whatsappNumber: '8884501501' }), /^I'm signing in to swiggy\.com with your WhatsApp number ending 1501, and it sent a sign-in code to that phone\./)
assert.match(sc, /if\(whatsappPhoneProvider\)credential=\{username:params\.phoneLogin!\.number,secret:'',/, 'nothing secret, nothing stored')
assert.match(bc, /phoneLogin:\{number:indianMobileFromWhatsApp\(params\.actor\.whatsappId\)!,telegramId:String\(tg\)\}/)
assert.match(read('lib/agent/account-site-gate.ts'), /if \(\(provider\?\.phoneLogin \|\| provider\?\.phoneOnly\) && indianMobileFromWhatsApp\(actor\.whatsappId\)\) gate = null/)
// 16 Oct live: the code was typed but Swiggy's upper-case "VERIFY OTP" link was never pressed.
assert.match(script, /candidates=page\.locator\('button, a, \[role="button"\], input\[type="submit"\]'\)/)
assert.match(script, /await page\.keyboard\.press\('Enter'\)/)
console.log('verify-login-code-flow: whatsapp number ok')

// 16 Oct 09:57 live: the earlier Swiggy read waiting for its code held the browser (browser_handoff_in_use).
assert.ok(bc.indexOf('await releaseOlderReadHandoffs(tg,params.actor.userId,params.runId)') < bc.indexOf("if(runMetadata.handoff?.releaseUrl){"), 'older waiting reads are released first')
assert.match(bc, /if\(String\(meta\.mode\|\|'read'\)!=='read'\|\|meta\.flow\|\|meta\.commerce_parent_id\|\|meta\.comparison_parent_id\|\|meta\.site_session\)continue/, 'never bookings, sign-ups, comparisons or Settings sign-ins')
assert.match(bc, /metadata_json:\{\.\.\.rest,state:'closed_stale'\},summary:'Replaced by your newer request\.'/)
console.log('verify-login-code-flow: older reads released')

// 16 Oct live: Swiggy's sign-in panel did not open; hand over the same browser instead of "couldn't find that".
assert.match(sc, /if\(!vaultFilled&&params\.mode==='read'\)savedLoginMissed=true/)
assert.match(sc, /if\(savedLoginMissed&&params\.reserveHumanHandoff===true&&!providerBooking\)\{/)
assert.match(bc, /if\(result\.authReason==='login_unavailable'\)\{/)
assert.match(bc, /Open this, tap Take control and sign in yourself, then tap Resume\. I'll carry on with your question from there/)
console.log('verify-login-code-flow: login handover ok')

// 16 Oct 11:31 live: "swiggy.com sent a sign-in code" but no SMS arrived. A code is claimed only when the site shows
// its code screen; otherwise Gogo hands over and logs the site's own error line (digits masked).
assert.match(sc, /codeRequested=codeScreen;/)
assert.doesNotMatch(sc, /else if\(!passFields\.length\) codeRequested=true;/)
assert.match(sc, /vaultFill\.phoneCode&&vaultFill\.codeRequested\)\)\)/)
assert.match(sc, /VAULT_CODE_NOT_SHOWN:/)
assert.match(sc, /m\[0\]\.replace\(\/\\d\{4,\}\/g,'••'\)/)
console.log('verify-login-code-flow: code screen verified')

// 16 Oct 12:52 live: the SMS code reached WhatsApp 4 seconds before Gogo marked the run as waiting, went to the chat
// model, and it replied "Using that code to sign in now" (untrue). An early code now waits for the run, and a bare
// code with nothing waiting never reaches the chat model.
const waRoute = read('app/api/webhooks/whatsapp/route.ts')
assert.match(waRoute, /const codeRunId = await findLoginCodeRun\(resolvedUser\.telegramId\) \|\| await waitForLoginCodeRun\(resolvedUser\.telegramId\)/)
assert.match(waRoute, /if \(await hasRecentBrowserRun\(resolvedUser\.telegramId\)\) \{\n\s+const notUsed = "I'm not waiting for a sign-in code right now, so I didn't use that one\./)
assert.match(bc, /export async function waitForLoginCodeRun\(tg:number\|string,maxMs=24_000\)/)
console.log('verify-login-code-flow: early code ok')
