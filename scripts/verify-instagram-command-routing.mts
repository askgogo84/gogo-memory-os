import assert from 'node:assert/strict'
import {detectInstagramPreviewCard, isInstagramReelPreview} from '../lib/services/reel-saver'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
const {parseConnectedProviderReadCommand,parseBrowserCommand} = await import('../lib/agent/browser-command')

const commands = [
  'Open Instagram and tell me what the latest 3 posts on @zomato are about',
  'Use the browser to research instagram.com/zomato and summarise the latest 3 posts',
  'Could you please open Instagram and show me the latest posts?',
  'What are the latest posts on Instagram about?',
  'Instagram is where I want you to research Zomato',
  'Use the browser to read https://www.instagram.com/zomato/ and summarise the latest 3 posts',
]
for (const command of commands) {
  assert.equal(detectInstagramPreviewCard(command), false, command)
  assert.equal(isInstagramReelPreview(command), false, command)
}
for (const preview of ['Zomato on Instagram: A new restaurant story', 'Zomato on Instagra...: A new restaurant story', 'Instagram:\nA new restaurant story']) {
  assert.equal(detectInstagramPreviewCard(preview), true, preview)
  assert.equal(isInstagramReelPreview(preview), true, preview)
}
const exact = parseConnectedProviderReadCommand(commands[0])
assert.ok(exact, 'the exact dashboard/WhatsApp acceptance prompt reaches the read executor')
assert.equal(new URL(exact.url).hostname, 'www.instagram.com')
assert.equal(exact.mode, 'read')
assert.ok(exact.objective.includes('@zomato'), 'original objective survives routing')
assert.equal(parseConnectedProviderReadCommand('Open Instagram and Zomato and show my orders'), null, 'actual multi-provider requests remain rejected')
assert.ok(parseBrowserCommand(commands[5]), 'full URL acceptance prompt reaches the browser parser')
console.log('Instagram requests bypass preview saving; genuine forwarded cards and browser objective preserved')
