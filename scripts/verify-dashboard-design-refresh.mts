import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home=readFileSync(new URL('../app/dashboard/(app)/home/page.tsx',import.meta.url),'utf8')
const rail=readFileSync(new URL('../components/dashboard/side-rail.tsx',import.meta.url),'utf8')
const tabs=readFileSync(new URL('../components/dashboard/tab-bar.tsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
const library=readFileSync(new URL('../app/dashboard/(app)/library/page.tsx',import.meta.url),'utf8')
const connections=readFileSync(new URL('../app/dashboard/(app)/connections/page.tsx',import.meta.url),'utf8')

assert.match(css,/AskGogo Final-Dark dashboard system/)
assert.match(css,/--color-gogo-cream: #0b0b0b/)
assert.match(css,/--color-gogo-teal: #2fb8a6/)
assert.match(css,/--color-gogo-ink: #f2efea/)

for(const label of ['Today','Gogo','Activity','Needs you','Background','Goals','Memory','Library','Connections','Vault','You']){
  assert.ok(rail.includes("label:'"+label+"'"),'rail must expose '+label)
}
for(const label of ['Today','Gogo','Activity','Memory','You']){
  assert.ok(tabs.includes("label:'"+label+"'"),'mobile tabs must expose '+label)
}

assert.match(home,/Needs you/)
assert.match(home,/In the background/)
assert.match(home,/Safe mode on/)
assert.match(home,/CommandBar/)
assert.match(library,/Saved documents/)
assert.match(connections,/Security boundary/)
assert.match(connections,/Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory/)

console.log('✅ Final-Dark dashboard design regression passed')
