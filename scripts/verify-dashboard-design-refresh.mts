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

// 21 Oct approved mock (Muse + Wajo): three main places plus Settings; the other sections sit under More.
for(const label of ['Home','Tasks','Memory','Chat with Gogo','Calendar','Lists','Library','Goals','Vault','Settings']){
  assert.ok(rail.includes("label:'"+label+"'"),'nav must expose '+label)
}
assert.ok(mobile.includes('<NavLinks counts={counts}'),'phone drawer must use the shared nav list')
assert.ok(!mobile.includes('export function MobileTabBar'),'21 Oct Wajo layout: no bottom tab bar on the phone; the menu drawer and Gogo pill carry navigation')

assert.match(home,/FeedTabs/)
assert.match(readFileSync(new URL('../components/dashboard/feed-list.tsx',import.meta.url),'utf8'),/Needs you[\s\S]*On radar[\s\S]*Recent/)
assert.match(home,/asks before it books, pays or sends anything/)
assert.match(home,/HomeAsk/)
assert.match(library,/Saved documents/)
assert.match(connections,/Security boundary/)
assert.match(connections,/Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory/)

console.log('✅ Final-Dark dashboard design regression passed')
