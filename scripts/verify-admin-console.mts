// Admin console v1: access gate wiring, password/cookie crypto, metering classification and pricing.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { classifyRequest, priceEvent, tokensFromBody, modelFamily, DEFAULT_RATES } from '../lib/metering/core.ts'

process.env.DASHBOARD_THROTTLE_PEPPER = 'test-pepper'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const auth = await import('../lib/admin/console-auth.ts')

// ── Metering ────────────────────────────────────────────────────────────────
assert.deepEqual(classifyRequest('https://api.anthropic.com/v1/messages', 'POST'), { vendor: 'anthropic', category: 'llm' })
assert.equal(classifyRequest('https://api.anthropic.com/v1/messages/count_tokens', 'POST'), null)
assert.equal(classifyRequest('https://api.anthropic.com/v1/messages', 'GET'), null)
assert.deepEqual(classifyRequest('https://api.openai.com/v1/chat/completions', 'POST'), { vendor: 'openai', category: 'llm' })
assert.deepEqual(classifyRequest('https://api.inceptionlabs.ai/v1/chat/completions', 'POST'), { vendor: 'inception', category: 'llm' })
assert.deepEqual(classifyRequest('https://api.tavily.com/search', 'POST'), { vendor: 'tavily', category: 'search' })
assert.deepEqual(classifyRequest('https://google.serper.dev/search', 'POST'), { vendor: 'serper', category: 'search' })
assert.deepEqual(classifyRequest('https://api.bolna.ai/call', 'POST'), { vendor: 'bolna', category: 'call' })
assert.equal(classifyRequest('https://api.bolna.ai/executions/abc', 'GET'), null)
assert.equal(classifyRequest('https://qenhjcooyecmatwducpu.supabase.co/rest/v1/admin_cost_events', 'POST'), null, 'metering writes must never meter themselves')
assert.equal(modelFamily('anthropic', 'claude-haiku-4-5'), 'anthropic.haiku')
assert.equal(modelFamily('anthropic', 'claude-sonnet-4-5'), 'anthropic.sonnet')
assert.equal(modelFamily('openai', 'gpt-4.1-mini'), 'openai.mini')
const t = tokensFromBody({ model: 'claude-haiku-4-5', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 1000 } })
assert.deepEqual(t, { model: 'claude-haiku-4-5', input: 1100, output: 200 })
assert.deepEqual(tokensFromBody({ model: 'gpt-4o-mini', usage: { prompt_tokens: 50, completion_tokens: 5 } }), { model: 'gpt-4o-mini', input: 50, output: 5 })
// 1M input + 1M output on Haiku at $1/$5 = $6 → ₹528 at 88
assert.deepEqual(priceEvent({ vendor: 'anthropic', category: 'llm', model: 'claude-haiku-4-5', inputTokens: 1e6, outputTokens: 1e6 }, DEFAULT_RATES), { inr: 528, usd: 6 })
assert.deepEqual(priceEvent({ vendor: 'twilio', category: 'whatsapp.outbound' }, DEFAULT_RATES), { inr: 0.35, usd: null })
assert.deepEqual(priceEvent({ vendor: 'unknown', category: 'x' }, DEFAULT_RATES), { inr: 0, usd: null })

// ── Password + console cookie ───────────────────────────────────────────────
{
  const h = auth.hashPassword('correct horse battery')
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  assert.equal(auth.verifyPassword('correct horse battery', h), true)
  assert.equal(auth.verifyPassword('wrong', h), false)
  const c = auth.signConsoleCookie('+918310441698', h, 1_000)
  assert.equal(auth.readConsoleCookie(c, '+918310441698', h, 2_000), true)
  assert.equal(auth.readConsoleCookie(c, '+919999999999', h, 2_000), false, 'cookie is bound to the admin number')
  assert.equal(auth.readConsoleCookie(c, '+918310441698', auth.hashPassword('other password'), 2_000), false, 'changing the password ends every console session')
  assert.equal(auth.readConsoleCookie(c, '+918310441698', h, 1_000 + auth.ADMIN_SESSION_MS + 1), false, 'expires after 12 hours')
  assert.equal(auth.readConsoleCookie(c.replace(/.$/, c.endsWith('A') ? 'B' : 'A'), '+918310441698', h, 2_000), false, 'tampered signature rejected')
  assert.equal(auth.canDo('viewer', 'operator'), false)
  assert.equal(auth.canDo('owner', 'operator'), true)
}

// ── Wiring ───────────────────────────────────────────────────────────────────
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
const stopAt = wa.indexOf('isStopMessage(String(formData.get')
const gateAt = wa.indexOf('await checkWhatsAppAccess(from, profileName')
const resolveAt = wa.indexOf("await resolveUser({ channel: 'whatsapp'")
assert.ok(stopAt > 0 && gateAt > stopAt && resolveAt > gateAt, 'gate runs after STOP and before a users row can be created')
assert.match(wa.slice(gateAt, resolveAt), /if \(!access\.allow\)[\s\S]*return new NextResponse\(emptyTwiml\(\)/)
assert.match(wa, /meterAs\(resolvedUser\.telegramId, 'whatsapp'\)/)

const gate = readFileSync('lib/access/gate.ts', 'utf8')
assert.match(gate, /ACCESS_GATE_ENABLED !== 'false'/)
assert.match(gate, /isAdminPhone\(p\)/)
assert.match(gate, /access_status === 'blocked'/)
assert.match(gate, /status === 'invited' \|\| row\?\.status === 'joined'/)
assert.match(gate, /reason: 'gate_error'/, 'database trouble lets messages through')
assert.match(gate, /NOTIFY_EVERY_MS = 24 \* 60 \* 60 \* 1000/)

assert.match(readFileSync('lib/dashboard/session.ts', 'utf8'), /access_status === 'blocked'\) return null/)
assert.match(readFileSync('lib/dashboard/whatsapp-otp.ts', 'utf8'), /access_status !== 'blocked'/)

const layout = readFileSync('app/admin/(console)/layout.tsx', 'utf8')
assert.match(layout, /requireAdminConsole\('viewer'\)/)
assert.match(layout, /redirect\(/)
for (const r of ['action', 'archify']) assert.match(readFileSync(`app/api/admin/console/${r}/route.ts`, 'utf8'), /requireAdminConsole\(/, `${r} route must require the unlocked console`)
const action = readFileSync('app/api/admin/console/action/route.ts', 'utf8')
assert.ok(action.indexOf('verifySameOrigin(req)') < action.indexOf('await req.json()'))
assert.ok(action.indexOf('requireAdminConsole(') < action.indexOf('await req.json()'))
const actions = readFileSync('lib/admin/actions.ts', 'utf8')
assert.match(actions, /if \(!canDo\(admin\.role, min\)\)/)
assert.match(actions, /cannot_block_yourself/)
assert.match(actions, /dashboard_sessions'\)\.delete\(\)\.eq\('telegram_id', tid\)/, 'blocking signs the user out of the dashboard')
const unlock = readFileSync('app/api/admin/console/unlock/route.ts', 'utf8')
assert.match(unlock, /recentFailures/)
assert.match(unlock, /httpOnly: true, secure: true, sameSite: 'strict'/)

const sql = readFileSync('supabase/migrations/20261021150000_admin_console_v1.sql', 'utf8')
for (const tbl of ['admin_members', 'admin_audit_log', 'admin_cost_events', 'admin_rate_card', 'admin_tools', 'admin_tool_costs', 'cron_heartbeats', 'admin_login_attempts', 'admin_settings']) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${tbl}`))
  assert.match(sql, new RegExp(`'${tbl}'`), `${tbl} gets RLS + grants`)
}
assert.match(sql, /add column if not exists access_status text not null default 'active'/, 'existing users keep access')
assert.ok(existsSync('instrumentation.ts') && /installFetchMeter/.test(readFileSync('instrumentation.ts', 'utf8')))
assert.match(readFileSync('proxy.ts', 'utf8'), /matcher: \['\/api\/cron\/:path\*', '\/api\/followups'\]/)

console.log('verify-admin-console: ok')

// ── Welcome copy (approved 21 Oct) ───────────────────────────────────────────
const welcome = await import('../lib/bot/handlers/welcome.ts')
const premium = await import('../lib/bot/handlers/whatsapp-direct-premium.ts')
const onboarding = await import('../lib/bot/handlers/onboarding.ts')
const intro = welcome.buildWelcomeIntro('Divya Rao')
assert.match(intro, /^👋 Hey Divya, I'm \*AskGogo\*/)
for (const part of ['*Book*', '*Compare prices*', '*Travel*', '*Remember*', '*Calendar & email*', '*Track*', '*Brief you*', 'before I pay, send or book', 'app.askgogo.in/dashboard', '*help*']) assert.ok(intro.includes(part), part)
assert.equal(onboarding.buildOnboardingMenu('Divya'), welcome.buildWelcomeIntro('Divya'), 'new users get the approved intro')
assert.equal(welcome.welcomeFirstName('Friend'), 'there')
assert.match(premium.getDirectWhatsappPremiumReply('Hi', 'Nithin K')!.text, /^👋 Welcome back, Nithin!/)
assert.equal(premium.getDirectWhatsappPremiumReply('help')!.text, welcome.HELP_MENU)
assert.equal(premium.isGreeting('Hello'), true); assert.equal(premium.isGreeting('Hello, book a table'), false)
for (const t of [intro, welcome.buildWelcomeBack('x'), welcome.buildAccessGrantedText('x'), welcome.HELP_MENU]) assert.doesNotMatch(t, /(^|\s)_[^_\n]+_(\s|$)/, 'no italics')
assert.match(welcome.buildAccessGrantedText('Divya'), /^🎉 You're in, Divya!/)
assert.match(welcome.ACCESS_GRANTED_TEMPLATE_BODY, /^Hi \{\{1\}\}, your AskGogo access is now active\./)
assert.ok(!/\{\{1\}\}\s*$/.test(welcome.ACCESS_GRANTED_TEMPLATE_BODY), 'a WhatsApp template cannot end with a variable')
const waRoute = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(waRoute, /if \(isGreeting\(bodyText\)\) \{[\s\S]{0,200}return new NextResponse/, 'a bare Hi from a new person gets one intro, not two')
assert.match(readFileSync('lib/admin/actions.ts', 'utf8'), /sendWhatsAppAccessGranted\(phone, welcomeFirstName\(name\), buildAccessGrantedText\(name\), ACCESS_GRANTED_TEMPLATE_BODY\)/)
console.log('verify-admin-console: welcome ok')
