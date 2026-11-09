// Gogo Spaces schema (8 Nov): declarative only — markup, scripts, SQL, URLs and unknown sources/skills are refused;
// actions can never pre-approve; refresh is gated by the owner's connector permissions; edits are versioned.
import assert from 'node:assert/strict'
const sp = await import('../lib/spaces/schema')
const skills = (id: string) => ({ 'merchant.order.accept': { exactActionApproval: true }, 'merchant.order.reject': { exactActionApproval: true } } as any)[id] || null
const NOW = Date.parse('2026-11-08T03:00:00Z')

// 1. Templates validate; capabilities derived from sources.
const scope = { kind: 'user' as const, telegramId: '9007199254740993' }
for (const t of ['my_day', 'trip_board', 'tipplr_exceptions'] as const) { const s = sp.templateSpace(t, scope, NOW); assert.deepEqual(sp.validateSpace(s, skills), [], t); assert.equal(s.version, 1) }
assert.deepEqual(sp.spaceCapabilities(sp.templateSpace('my_day', scope, NOW)).sort(), ['calendar', 'email', 'memory', 'reminders'])
assert.deepEqual(sp.spaceCapabilities(sp.templateSpace('tipplr_exceptions', { kind: 'workspace', workspaceId: '7e1b6f4a-2c0d-4b58-9c3e-5a1f0d9b2e77' }, NOW)), ['merchant'])
console.log('✓ three templates validate; capabilities follow the sources')

// 2. Nothing executable gets through.
const base = sp.templateSpace('my_day', scope, NOW)
const bad = (patch: (s: any) => void) => { const s = JSON.parse(JSON.stringify(base)); patch(s); return sp.validateSpace(s, skills) }
assert.ok(bad(s => { s.blocks[0].title = '<img src=x onerror=alert(1)>' }).some(p => /markup/.test(p.problem)))
assert.ok(bad(s => { s.title = 'Day javascript:alert(1)' }).some(p => /markup/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'n', type: 'note', text: 'select * from users where 1=1' }) }).some(p => /SQL/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'n', type: 'note', text: 'see https://evil.example' }) }).some(p => /URLs/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'n', type: 'note', text: 'Hello {{owner.token}}' }) }).some(p => /template/.test(p.problem)))
assert.ok(bad(s => { s.blocks[0].source = { id: 'users.raw' } }).some(p => /registered source/.test(p.problem)))
assert.ok(bad(s => { s.blocks[0].html = '<b>' }).some(p => /unknown field/.test(p.problem)))
assert.ok(bad(s => { s.blocks[0].source.params = { q: 'drop table memories; --' } }).some(p => /SQL/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'a', type: 'actions', actions: [{ label: 'Accept', skillId: 'shell.exec', input: {}, requiresApproval: true }] }) }).some(p => /registered skill/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'a', type: 'actions', actions: [{ label: 'Accept', skillId: 'merchant.order.accept', input: { orderId: 'T-1' }, requiresApproval: false }] }) }).some(p => /never pre-approves/.test(p.problem)))
assert.ok(bad(s => { s.blocks.push({ id: 'a', type: 'actions', actions: [{ label: 'Accept', skillId: 'merchant.order.accept', input: { orderId: { $ne: 1 } }, requiresApproval: true }] }) }).some(p => /scalar only/.test(p.problem)))
assert.deepEqual(bad(s => { s.blocks.push({ id: 'a', type: 'actions', title: 'Decide', actions: [{ label: 'Accept 15 min', skillId: 'merchant.order.accept', input: { orderId: 'T-1', prepMinutes: 15 }, requiresApproval: true }] }) }), [])
assert.ok(bad(s => { s.scope = { kind: 'user', telegramId: 'abc' } }).some(p => p.path === 'scope'))
assert.ok(bad(s => { s.refreshMinutes = 1 }).some(p => p.path === 'refreshMinutes'))
console.log('✓ markup, scripts, templates, SQL, URLs, unknown sources/fields/skills, pre-approval and object inputs refused')

// 3. Refresh gated by permissions: an off connector blocks only its blocks.
const g = sp.refreshableBlocks(base, c => c === 'email' ? 'off' : 'read')
assert.deepEqual(g.blocked.map(b => [b.block.id, b.capability]), [['mail', 'email']]); assert.equal(g.ok.length, 3)
console.log('✓ a disconnected connector blocks its block only')

// 4. Versioned edits: each edit is a new version with history; a bad edit changes nothing.
let r = sp.editSpace(base, { op: 'rename', title: 'Divya & me today' }, scope.telegramId, skills, NOW + 1000)
assert.ok('space' in r); const v2 = (r as any).space; assert.equal(v2.version, 2); assert.equal(v2.history.at(-1).change, 'renamed to "Divya & me today"'); assert.equal(v2.history.at(-1).by, scope.telegramId)
r = sp.editSpace(v2, { op: 'add_block', block: { id: 'nithin', type: 'note', title: 'Nithin', text: 'Ask about the Tipplr API paths' }, after: 'today' }, scope.telegramId, skills, NOW + 2000)
assert.ok('space' in r); const v3 = (r as any).space; assert.equal(v3.version, 3); assert.equal(v3.blocks[1].id, 'nithin')
r = sp.editSpace(v3, { op: 'move_block', id: 'nithin', after: null }, scope.telegramId, skills); assert.ok('space' in r); assert.equal((r as any).space.blocks[0].id, 'nithin')
r = sp.editSpace(v3, { op: 'set_text', id: 'nithin', text: '<script>1</script>' }, scope.telegramId, skills); assert.ok('problems' in r)
r = sp.editSpace(v3, { op: 'remove_block', id: 'nope' }, scope.telegramId, skills); assert.ok('problems' in r)
assert.equal(base.version, 1, 'edits never mutate the input')
console.log('✓ edits are versioned with history; invalid edits are refused and change nothing')
console.log('Spaces schema (8 Nov) checks passed')
