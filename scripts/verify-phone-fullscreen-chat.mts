// Approved 22 Oct full-screen phone chat (Wajo-style): the phone chat fills the screen, no header bar, docked composer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const chat = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
assert.match(chat, /max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:h-\[100dvh\]/, 'phone chat is a full-screen layer')
assert.match(chat, /<header className="hidden shrink-0[^"]*lg:block/, 'desktop keeps its header; phone has none')
assert.match(chat, /<ChannelPill channels=\{channels\}/, 'one channel pill on phone instead of a chip row')
assert.match(chat, /mb-3 hidden gap-2\.5 overflow-x-auto pb-1 lg:flex/, 'no permanent suggestion row on phone in a conversation')
assert.match(chat, /onClick=\{stopWaiting\}/, 'send becomes stop while Gogo works')
assert.match(chat, /Stopped waiting\. If Gogo had already started something, it shows in Tasks\./, 'stop never claims nothing happened')
assert.match(chat, /Gogo can make mistakes\. It asks before it acts for you\./)
const pill = readFileSync('components/dashboard/chat-channels.tsx', 'utf8')
assert.match(pill, /export function ChannelPill/)
console.log('Phone chat: full screen, floating controls, channel pill, docked composer, honest stop')
