// Muse case 24 (invite image) and 20 (draft first) — 11 Oct overnight.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { imageRequest, imageRequestRefusal } = await import('../lib/services/image-reply.ts')
for (const t of ['Make an invite image for a birthday party on Sunday at 5 pm at my place.', 'Create a poster for our Diwali sale', 'design a birthday card for Amma', 'Generate a wallpaper of the Western Ghats in monsoon'])
  assert.ok(imageRequest(t), t)
for (const t of ['make me a nutrition card', 'remind me to make an invite tomorrow', 'show my image notes', 'what is a poster session', 'add the party to my calendar'])
  assert.equal(imageRequest(t), null, t)
assert.match(String(imageRequestRefusal('make a picture of me as a superhero')), /real people/)
assert.equal(imageRequestRefusal('Make an invite image for a birthday party'), null)

const svc = readFileSync('lib/services/image-reply.ts', 'utf8')
assert.match(svc, /No real people, no brand logos or trademarked characters/)
assert.match(svc, /createSignedUrl\(path, 3600\)/)

const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
const at = (needle: string) => pm.indexOf(needle)
assert.ok(at('const imageText = imageRequest(incomingText)') > 0 && at('const imageText = imageRequest(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'), 'images are claimed before workflows and time routing')
assert.ok(at('const podcast = podcastRequest(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'))
assert.ok(at('const unsupported = unsupportedCapability(incomingText)') < at('const contentWorkflow = selectContentWorkflow(incomingText)'))
assert.match(pm, /mediaType: 'image\/png'/)

assert.match(readFileSync('lib/agent/content-workflows.ts', 'utf8'), /Never answer with only questions/, '20: workflow drafts first')
console.log('Image generation and draft-first workflow checks passed')
