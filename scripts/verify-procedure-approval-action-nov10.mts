// Live 10 Nov: the follow-up found its thread, then the approval insert failed the agent_approvals.action_type CHECK
// ('email.send' is not an allowed category) and the run ended as outcome_unknown with no card.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { approvalDbActionType } from '../lib/procedures/runtime.ts'
import { TEMPLATES } from '../lib/procedures/templates.ts'
import { followUpReply } from '../lib/procedures/entry.ts'
let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++ }
// The allowed list comes from the newest migration that defines the constraint, not from this test.
const defs = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && !f.includes('rollback')).sort()
  .map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).map(sql => sql.match(/agent_approvals_action_type_check\s+check \(action_type in \(([^)]+)\)\)/i)?.[1]).filter(Boolean) as string[]
ok(defs.length >= 1, 'found the action_type constraint in migrations')
const allowed = new Set(defs[defs.length - 1].split(',').map(s => s.trim().replace(/'/g, '')))
ok(allowed.has('send_email') && allowed.has('booking'), 'constraint list parsed (positive control)')
const actions = TEMPLATES.flatMap(t => t.nodes.filter(x => x.type === 'APPROVAL').map(x => x.approval!.actionType))
ok(actions.length >= 2, 'templates have approvals')
for (const a of actions) ok(allowed.has(approvalDbActionType(a)), `${a} maps to an allowed category`)
ok(!allowed.has('email.send'), "the raw procedure action is NOT an allowed category (the bug's cause)")
assert.throws(() => approvalDbActionType('payments.transfer'), /procedure_approval_action_unmapped/); n++
const src = readFileSync('lib/procedures/runtime.ts', 'utf8')
ok(/action_type: approvalDbActionType\(node\.approval!\.actionType\)/.test(src), 'the insert uses the mapped category')
ok(/action: node\.approval!\.actionType/.test(src), "the procedure's own action name is kept in the payload")
ok(/catch \(e: any\) \{ console\.error\('PROCEDURE_APPROVAL_STAGE_FAILED:'[\s\S]{0,220}return \{ status: 'blocked', error: `approval_stage_failed:/.test(src), 'a staging failure is a known nothing-ran (blocked), logged, not outcome_unknown')
ok(/check your Sent folder/.test(followUpReply('outcome_unknown', 'whatsapp')) && !/Nothing was sent/.test(followUpReply('outcome_unknown', 'whatsapp')), 'an uncertain outcome never claims nothing was sent')
console.log(`PROCEDURE_APPROVAL_ACTION_OK ${n} checks`)
