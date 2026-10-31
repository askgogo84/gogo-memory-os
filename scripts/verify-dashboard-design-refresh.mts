import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home=readFileSync(new URL('../app/dashboard/(app)/home/page.tsx',import.meta.url),'utf8')
const rail=readFileSync(new URL('../components/dashboard/dashboard-nav.tsx',import.meta.url),'utf8')
const mobile=readFileSync(new URL('../components/dashboard/mobile-nav.tsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
const library=readFileSync(new URL('../app/dashboard/(app)/library/page.tsx',import.meta.url),'utf8')
const connections=readFileSync(new URL('../app/dashboard/(app)/connections/page.tsx',import.meta.url),'utf8')

assert.match(css,/AskGogo Final-Dark dashboard system/)
assert.match(css,/--color-gogo-cream: #0b0b0b/)
assert.match(css,/--color-gogo-teal: #2fb8a6/)
assert.match(css,/--color-gogo-ink: #f2efea/)

// Approved 22 Oct Duet-parity mock: Chat · Tasks · Make, the rest under More.
for(const label of ['Chat','Tasks','Make','Memory','Calendar','Lists','Library','Goals','Vault','Settings']){
  assert.ok(rail.includes("label:'"+label+"'"),'nav must expose '+label)
}
assert.ok(mobile.includes('<NavLinks counts={counts}'),'phone drawer must use the shared nav list')
assert.ok(!mobile.includes('export function MobileTabBar'),'one phone tab bar only (components/dashboard/bottom-tabs.tsx)')
{
  const tabs = readFileSync('components/dashboard/bottom-tabs.tsx','utf8')
  assert.match(tabs, /NAV\.map/, 'bottom tabs are the shared Chat · Tasks · Make list')
  assert.match(tabs, /if \(pathname === '\/dashboard\/chat'\) return null/, 'the full-screen phone chat keeps its own controls')
  assert.match(readFileSync('app/dashboard/(app)/layout.tsx','utf8'), /<BottomTabs \/>/)
}

// Home v2 (23 Oct): Home shows the day as sections; the Needs you · On radar · Recent tabs live on Tasks.
assert.match(home,/Needs you now[\s\S]*Gogo is handling[\s\S]*Coming up today[\s\S]*Can wait[\s\S]*Done today/)
assert.match(readFileSync(new URL('../components/dashboard/feed-list.tsx',import.meta.url),'utf8'),/Needs you[\s\S]*On radar[\s\S]*Recent/)
assert.match(home,/asks before it books, pays or sends anything/)
assert.match(home,/HomeAsk/)
assert.match(library,/Saved documents/)
assert.match(connections,/Security boundary/)
assert.match(connections,/Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory/)

console.log('✅ Final-Dark dashboard design regression passed')
{
  // Approved 22 Oct Duet-parity mock: land on Chat, brief on top of the one thread, channels in the rail.
  const chat = readFileSync(new URL('../components/dashboard/gogo-chat.tsx', import.meta.url), 'utf8')
  assert.match(chat, /\{brief&&!channel&&!historyOpen&&<ChatBriefCard brief=\{brief\}\/>\}/)
  assert.match(chat, /const wanted=searchParams\.get\('channel'\)/)
  const side = readFileSync(new URL('../components/dashboard/side-rail.tsx', import.meta.url), 'utf8')
  assert.match(side, /Channels share one memory\./); assert.ok(!side.includes('UsageCard') && !side.includes('RecentList'))
  assert.match(readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8'), /const DASHBOARD_HOME = '\/dashboard\/chat'/)
  assert.match(readFileSync(new URL('../app/dashboard/(app)/chat/page.tsx', import.meta.url), 'utf8'), /brief=\{brief\}/)
}
console.log('verify-dashboard-design-refresh: duet shell ok')


// Conditional P1 privacy regression: execute the ACTUAL Dashboard shell module
// with inert service-role/usage stubs; never query a production account.
{
  const { runInNewContext } = await import('node:vm')
  const ts = (await import('typescript')).default
  const { exactSessionOwnerId } = await import('../lib/dashboard/owner-identity')
  const source = readFileSync(new URL('../lib/dashboard/shell-data.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const reads: Array<{ table: string; field: string; value: string }> = []
  const usageReads: string[] = []
  const rows: Record<string, { name: string; google_calendar_connected: boolean; gmail_connected: boolean }> = {
    '42': { name: 'Ada Lovelace', google_calendar_connected: true, gmail_connected: false },
    '43': { name: 'Bea Charles', google_calendar_connected: false, gmail_connected: false },
    '-2251799813685248': { name: 'Nora Negative', google_calendar_connected: false, gmail_connected: true },
  }
  const fakeDb = {
    from(table: string) {
      let owner = ''
      const q = {
        select(_columns: unknown, _opts?: unknown) { return q },
        eq(field: string, value: unknown) {
          reads.push({ table, field, value: String(value) })
          if (field === 'telegram_id') owner = String(value)
          return q
        },
        neq(_field: string, _value: unknown) { return q },
        async maybeSingle() { return { data: rows[owner] || null, error: null } },
        then(resolve: (result: { count: number }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve({ count: owner === '42' ? 1 : 0 }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const shellModule: Record<string, any> = {}
  runInNewContext(compiled, {
    exports: shellModule, console, Number, String, Boolean, Promise, Array, Object,
    require: (specifier: string) => {
      if (specifier === '@/lib/supabase-admin') return { supabaseAdmin: fakeDb }
      if (specifier === '@/lib/dashboard/queries') return {
        getUsageSummary: async (owner: string) => {
          usageReads.push(owner)
          return { ok: true, planLabel: 'Starter', usage: { aiToday: 2, docsThisMonth: 1 }, limits: { aiPerDay: 10, docsPerMonth: 3 } }
        },
      }
      if (specifier === './owner-identity') return { exactSessionOwnerId }
      throw new Error('unexpected shell dependency: ' + specifier)
    },
  })
  const getShellData = shellModule.getShellData as (owner: string) => Promise<{
    name: string; plan: string | null; meters: unknown[]; setup: unknown[]
  }>
  assert.equal(typeof getShellData, 'function', 'the real shell module must execute')

  // Two distinct signed64 string identities round to the same Number in JS.
  // On a shell with downstream numeric meter readers, both must fail closed
  // before fetching another user's name, connections, usage or watch metadata.
  for (const bad of [
    '9007199254740992', '9007199254740993',
    '4242suffix', '042', '+42', '42.0', '4e1', '0',
    '9223372036854775808', '', ' ',
  ]) {
    reads.length = 0; usageReads.length = 0
    const out = await getShellData(bad)
    assert.equal(JSON.stringify(out), JSON.stringify({ name: '', plan: null, meters: [], setup: [] }), 'invalid owner must render an empty shell: ' + bad)
    assert.equal(reads.length, 0, 'invalid owner must never issue a privileged DB read: ' + bad)
    assert.equal(usageReads.length, 0, 'invalid owner must never issue a privileged meter read: ' + bad)
  }

  // Legitimate safe numeric and negative IDs still get their own profile and
  // truthful meters, with an exact canonical owner on every service-role read.
  for (const [owner, expectedName] of [
    ['42', 'Ada'], ['43', 'Bea'], ['-2251799813685248', 'Nora'],
  ]) {
    reads.length = 0; usageReads.length = 0
    assert.equal(exactSessionOwnerId(owner), owner)
    const out = await getShellData(owner)
    assert.equal(out.name, expectedName, 'safe owner gets only their own first name')
    assert.equal(out.plan, 'Starter')
    assert.equal(out.meters.length, 2)
    assert.equal(out.setup.length, 4)
    assert.equal(usageReads.join(','), owner, 'meter read uses the exact session owner')
    assert.equal(reads.filter(r => r.field === 'telegram_id').length, 3, 'three scoped shell DB lookups')
    assert.ok(reads.every(r => r.field !== 'telegram_id' || r.value === owner), 'no neighbour owner IDs in shell DB lookups')
  }
  console.log('✅ Dashboard shell owner isolation: signed64/partial IDs deny before all reads; distinct safe owners remain usable')
}
