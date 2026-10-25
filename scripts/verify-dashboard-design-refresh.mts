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
