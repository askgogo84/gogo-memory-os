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
// Review (PR #1562): a person reached after a menu hears the AI and recording notice; a keypad menu offers the number.
for (const p of [v.CALL_AGENT_PROMPT, v.GENERAL_CALL_AGENT_PROMPT]) assert.match(p, /When a person comes on after a menu or hold, first say you are an AI assistant from AskGogo calling for \{guest_name\} and that the call may be recorded\./)
const plan = { venue: 'Apollo Clinic', to: '+918012345678', source: 'the number you gave', guestName: 'Nithin', partySize: null, date: null, dateLabel: '', timeLabel: '', flexWindow: '', seating: '', purpose: 'Ask about Sunday hours.', test: false, redials: 0, createdAt: '2026-11-22T06:00:00Z', kind: 'general' }
const menuOut = { booked: false, confirmedTime: null, staffName: null, callbackAt: null, notes: 'A recorded phone menu answered and no person came on.' }
const t = v.callResultText(plan, 'completed', menuOut)
assert.match(t, /A recorded phone menu answered and no person came on\./); assert.match(t, /call them yourself on .*80123/); assert.doesNotMatch(t, /call again/)
const t2 = v.callResultText({ ...plan, kind: 'table', partySize: 2, venue: 'District 6' }, 'completed', menuOut)
assert.match(t2, /not booked\. A recorded phone menu/); assert.match(t2, /call them yourself/)
assert.match(v.callResultText(plan, 'completed', { ...menuOut, notes: 'They were closed.' }), /Say \*call again\* to retry\./, 'other answers keep the retry')
console.log('✓ a person after a menu hears the AI notice; a keypad menu result offers the number, not a retry')
