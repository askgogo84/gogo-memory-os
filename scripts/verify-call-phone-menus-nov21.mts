// 21 Nov (handoff calling gap: phone menus). Bolna documents DTMF only for callers pressing keys into an agent, not for
// an outbound agent pressing keys, so the agent navigates spoken menus by voice and ends a keypad-only menu politely;
// the result says a recorded menu answered, never a made-up answer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const v: any = await import('../lib/agent/voice-call')
for (const p of [v.CALL_AGENT_PROMPT, v.GENERAL_CALL_AGENT_PROMPT]) {
  assert.match(p, /If a recorded phone menu answers instead of a person: if it lets you speak, say the option that fits the task/)
  assert.match(p, /You cannot press keypad keys\. If the menu only accepts key presses, or repeats twice without reaching a person, say thank you and end the call\./)
  assert.match(p, /Never invent an answer from a recorded message\./)
  assert.ok(!/\{[a-z_]+\}/.test(p.replace(/\{(?:venue|guest_name|purpose|opening|details|party_size|date_label|time_label|flex_window|seating|contact_number)\}/g, '')), 'only known placeholders')
}
// New instructions reach Bolna only through new agent names (agents are looked up by name and created once).
assert.equal(v.CALL_AGENT_NAME, 'AskGogo booking caller v3')
assert.equal(v.GENERAL_CALL_AGENT_NAME, 'AskGogo general caller v3')
const src = readFileSync(new URL('../lib/agent/voice-call.ts', import.meta.url), 'utf8')
assert.equal((src.match(/if a recorded phone menu answered and no person came on, say exactly that/g) || []).length, 2, 'both result summaries report a menu')
console.log('✓ spoken menus are navigated by voice; keypad-only menus end politely and are reported as such')
