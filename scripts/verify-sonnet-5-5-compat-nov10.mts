// Sonnet 5.5 migration: request bodies are valid for the model, and answers are read whatever the block order.
// Rules from Anthropic's Sonnet 5.5 migration guide (thinking default on, sampling params / forced tool_choice /
// thinking:disabled / prefill → 400). No network: a fake client records what would be sent.
import assert from 'node:assert/strict'
import { forModel, textOf, isAdaptiveOnlyModel, TOOL_REQUIRED_NOTE } from '../lib/services/model-ids.ts'
let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++ }

// 1. textOf: thinking-first responses (the 10 Nov empty-reply incident) still yield the text.
ok(textOf([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'Gogo' }]) === 'Hello Gogo', 'text after a thinking block is read')
ok(textOf([{ type: 'text', text: 'plain' }]) === 'plain' && textOf([]) === '' && textOf(null) === '' && textOf([{ type: 'tool_use', input: {} }]) === '', 'plain, empty and odd shapes')

// 2. forModel: 5.5 gets a valid body; older models are untouched (positive control).
const base = { model: 'claude-sonnet-5-5', max_tokens: 100, temperature: 0.2, top_p: 0.9, top_k: 5, tool_choice: { type: 'any' }, messages: [{ role: 'user', content: 'hi' }] }
const f: any = forModel(base)
ok(!('temperature' in f) && !('top_p' in f) && !('top_k' in f), 'sampling params removed')
ok(f.thinking?.type === 'between_tools' && Object.keys(f.thinking).length === 1, 'thinking is between_tools with no other field')
ok(f.output_config?.effort === 'low', 'low effort by default (cost)')
ok((forModel(base, { effort: 'high' }) as any).output_config.effort === 'high', 'caller can raise effort')
ok(f.tool_choice.type === 'auto', "forced tool_choice 'any' becomes 'auto'")
ok((forModel({ ...base, tool_choice: { type: 'tool', name: 'reply' } }) as any).tool_choice.type === 'auto', "forced tool_choice 'tool' becomes 'auto'")
ok(base.temperature === 0.2 && base.tool_choice.type === 'any', 'the input object is not mutated')
assert.throws(() => forModel({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '{' }] }), /model_prefill_unsupported/); n++
for (const m of ['claude-sonnet-4-5', 'claude-haiku-5-5', 'claude-haiku-4-5']) {
  const same = { ...base, model: m }
  ok(forModel(same) === same && !isAdaptiveOnlyModel(m), `${m} passes through unchanged`)
}
ok(isAdaptiveOnlyModel('claude-sonnet-5-5') && isAdaptiveOnlyModel('claude-sonnet-5-5-20261001'), 'dated ids are recognised')

// 3. Brain: what is sent, and how each answer shape is read.
const brain = await import('../lib/agent/brain.ts')
const ctx: any = { turns: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'Hi Divya' }], trackedFlights: [], sections: {}, name: 'Divya', timezone: 'Asia/Kolkata' }
const sent: any[] = []
const client = (content: any[]) => ({ messages: { create: async (body: any) => { sent.push(body); return { content, usage: { input_tokens: 10, output_tokens: 5 } } } } }) as any
const noMeter = () => {}
// 5.5 calls a tool
let d: any = await brain.decide({ text: 'remind me to call Divya at 5', ctx, client: client([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', name: 'handle', input: { instruction: 'remind me to call Divya at 5' } }]), model: 'claude-sonnet-5-5', meter: noMeter })
ok(d.kind === 'handle', `5.5 tool call after a thinking block is used (got ${d.kind}${d.reason ? ':' + d.reason : ''})`)
const b55 = sent[sent.length - 1]
ok(b55.tool_choice.type === 'auto' && b55.thinking.type === 'between_tools' && !('temperature' in b55), '5.5 brain request is valid for the model')
ok(JSON.stringify(b55.system).includes(TOOL_REQUIRED_NOTE), 'the prompt says a tool call is required')
// 5.5 answers in plain text
d = await brain.decide({ text: 'thanks!', ctx, client: client([{ type: 'text', text: 'Anytime.' }]), model: 'claude-sonnet-5-5', meter: noMeter })
ok(d.kind === 'reply' && /Anytime/.test(d.text), `5.5 plain text is treated as a reply (got ${d.kind})`)
// 5.5 returns nothing usable
d = await brain.decide({ text: 'x', ctx, client: client([{ type: 'thinking', thinking: '', signature: 's' }]), model: 'claude-sonnet-5-5', meter: noMeter })
ok(d.kind === 'skip', 'an empty 5.5 answer falls through to the older path, never an empty reply')
// 4.5 and Haiku 5.5 keep the forced tool call and get no extra note
for (const m of ['claude-sonnet-4-5', 'claude-haiku-5-5']) {
  await brain.decide({ text: 'hi', ctx, client: client([{ type: 'tool_use', name: 'reply', input: { text: 'Hi' } }]), model: m, meter: noMeter })
  const b = sent[sent.length - 1]
  ok(b.tool_choice.type === 'any' && !('thinking' in b) && !JSON.stringify(b.system).includes(TOOL_REQUIRED_NOTE), `${m} request is unchanged`)
}
// a plain-text answer from a model that CAN be forced is still not trusted as a reply
d = await brain.decide({ text: 'hi', ctx, client: client([{ type: 'text', text: 'Hi' }]), model: 'claude-sonnet-4-5', meter: noMeter })
ok(d.kind === 'skip' && d.reason === 'no_tool_use', '4.5 plain text stays no_tool_use')
console.log(`SONNET_5_5_COMPAT_OK ${n} checks`)
