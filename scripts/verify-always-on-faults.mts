// Actual exported runtime, inert persistence and tools. No provider/network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const actor = { userId: 'owner-a', legacyTelegramId: 123, whatsappId: 'inert', name: 'Fixture' };
function harness(mutation = false, status = 'queued') {
    const run: any = { id: 'r', telegram_id: '123', status: 'running', title: 'Fixture', metadata_json: { objective: 'Fixture' } };
    const step: any = { id: 's', run_id: 'r', telegram_id: '123', ordinal: 1, tool_name: 'fixture', title: 'Fixture', status, started_at: '2020-01-01T00:00:00Z', output_json: { runtime: { stepKey: 'fixture', dependsOn: [], lane: 'fixture', attempt: status === 'running' ? 1 : 0, maxAttempts: 4, mutation, verificationRequired: true, idempotencyKey: 'stable-key' } } };
    const tables: any = { agent_runs: [run], agent_steps: [step], agent_activity: [], agent_approvals: [] };
    const db = { from(table: string) {
            let op = 'read', value: any;
            const filters: ((r: any) => boolean)[] = [];
            const field = (r: any, k: string) => k.split(/->>?/).reduce((v: any, key: string) => v?.[key], r);
            const result = () => { const rows = tables[table].filter((r: any) => filters.every(f => f(r))); if (op === 'update')
                rows.forEach((r: any) => Object.assign(r, structuredClone(value))); if (op === 'insert')
                tables[table].push(structuredClone(value)); return { data: rows, error: null }; };
            const q: any = { select: () => q, order: () => q, update: (v: any) => { op = 'update'; value = v; return q; }, insert: (v: any) => { op = 'insert'; value = v; return q; }, eq: (k: string, v: any) => { filters.push(r => String(field(r, k)) === String(v)); return q; }, in: (k: string, v: any[]) => { filters.push(r => v.includes(field(r, k))); return q; }, lte: (k: string, v: any) => { filters.push(r => field(r, k) <= v); return q; }, maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] || null }; }, then: (a: any, b: any) => Promise.resolve(result()).then(a, b) };
            return q;
        } };
    const exports: any = {};
    runInNewContext(ts.transpileModule(readFileSync('lib/agent/autonomous-runtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (id: string) => { if (id === 'node:crypto')
            return { createHash }; if (id === '@/lib/supabase-admin')
            return { supabaseAdmin: db }; if (id === './specialist-registry')
            return { selectSpecialistRoute: () => ({ primary: 'research', supporting: [] }) }; if (id === './run-notify')
            return { notifyRunOutcome: async () => { } }; throw Error('Unmocked ' + id); }, console, Date, Promise });
    return { run, step, tables, runtime: exports, execute: (handler: any) => exports.executeAutonomousRun({ actor, runId: 'r', registry: { fixture: handler } }) };
}
let failures = 0;
async function check(name: string, fn: () => Promise<void>) { try {
    await fn();
    console.log('PASS ' + name);
}
catch (e: any) {
    failures++;
    console.error('FAIL ' + name + ': ' + e.message);
} }
await check('mutation timeout after provider effect never repeats', async () => {
    const h = harness(true);
    let effects = 0;
    const handler = async () => { effects++; throw Error('provider timeout after effect'); };
    await h.execute(handler);
    h.step.output_json.runtime.retryAt = null;
    await h.execute(handler);
    assert.equal(effects, 1);
    assert.equal(h.run.status, 'outcome_unknown');
    assert.equal(h.step.output_json.reconciliation_required, true);
});
await check('mutation missing readback is unknown, not retryable', async () => { const h = harness(true); await h.execute(async () => ({ status: 'completed', verified: false })); assert.equal(h.run.status, 'outcome_unknown'); assert.notEqual(h.step.status, 'queued'); });
await check('worker crash after mutation claim cannot replay', async () => { const h = harness(true, 'running'); await h.runtime.recoverStaleAutonomousSteps({ actor, runId: 'r' }); assert.equal(h.run.status, 'outcome_unknown'); assert.notEqual(h.step.status, 'queued'); });
await check('read-only lost session recovers and keeps checkpoint/key', async () => { const h = harness(false, 'running'); h.tables.agent_steps.push({ ...structuredClone(h.step), id: 'done', ordinal: 0, status: 'completed', output_json: { runtime: { stepKey: 'done' } } }); await h.runtime.recoverStaleAutonomousSteps({ actor, runId: 'r' }); assert.equal(h.step.status, 'queued'); assert.equal(h.tables.agent_steps[1].status, 'completed'); assert.equal(h.step.output_json.runtime.idempotencyKey, 'stable-key'); h.step.output_json.runtime.retryAt = null; await h.execute(async () => ({ status: 'completed', verified: true })); assert.equal(h.run.status, 'completed'); });
await check('duplicate scheduler waves claim one execution', async () => { const h = harness(); let calls = 0; await Promise.all([h.execute(async () => { calls++; return { status: 'completed', verified: true }; }), h.execute(async () => { calls++; return { status: 'completed', verified: true }; })]); assert.equal(calls, 1); });
await check('interrupted approval stays blocked and foreign owner cannot release', async () => { const h = harness(); h.step.output_json.runtime.approvalId = 'approval'; h.tables.agent_approvals.push({ id: 'approval', telegram_id: '999', status: 'approved' }); let calls = 0; await h.execute(async () => { calls++; return { status: 'completed', verified: true }; }); assert.equal(calls, 0); await assert.rejects(h.runtime.releaseApprovedAutonomousStep({ actor, runId: 'r', stepKey: 'fixture' }), /approval_required/); assert.equal(h.step.output_json.runtime.approvalId, 'approval'); });
await check('cross-channel continuation uses same owner checkpoint', async () => { const h = harness(); h.run.source = 'whatsapp'; h.step.status = 'completed'; h.step.output_json.reply = 'checkpoint'; const result = await h.runtime.executeAutonomousRun({ actor: { ...actor, surface: 'web' }, runId: 'r', registry: {} }); assert.equal(result.status, 'completed'); await assert.rejects(h.runtime.loadAutonomousRun('r', '999'), /missing/); assert.equal(h.step.output_json.reply, 'checkpoint'); });
await check('terminal unknown run cannot start queued steps', async () => { const h = harness(); h.run.status = 'outcome_unknown'; let calls = 0; await h.execute(async () => { calls++; return { status: 'completed', verified: true }; }); assert.equal(calls, 0); });
await check('repeated read crashes exhaust attempts', async () => { const h = harness(false, 'running'); h.step.output_json.runtime.attempt = 4; await h.runtime.recoverStaleAutonomousSteps({ actor, runId: 'r' }); assert.equal(h.step.status, 'failed'); });
await check('late worker cannot overwrite a replacement attempt', async () => {
    const h = harness();
    let resume: any;
    let entered: any;
    const started = new Promise<void>(r => { entered = r; });
    const old = h.execute(async () => { entered(); return new Promise(r => { resume = r; }); });
    await started;
    h.step.started_at = '2020-01-01T00:00:00Z';
    await h.runtime.recoverStaleAutonomousSteps({ actor, runId: 'r' });
    h.step.output_json.runtime.retryAt = null;
    await h.execute(async () => ({ status: 'completed', verified: true, output: { reply: 'replacement' } }));
    resume({ status: 'completed', verified: true, output: { reply: 'obsolete' } });
    await old;
    assert.equal(h.step.output_json.reply, 'replacement');
    assert.equal(h.step.output_json.runtime.attempt, 2);
});
await check('lost managed session restores saved context without replaying a provider action', async () => {
    const { resolveManagedSession } = await import('../lib/agent/managed-browser');
    const project = '11111111-1111-4111-8111-111111111111', context = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
    let state: any = null, session: any, created = 0, contexts = 0, unavailable = false;
    const store = { load: async () => structuredClone(state), save: async (v: any) => { state = structuredClone(v); } };
    const fetcher: any = async (url: any, init: any) => {
        const path = String(url).split('/v1/')[1], body = init?.body ? JSON.parse(init.body) : null;
        if (unavailable)
            throw Error('lost provider connection');
        let data: any;
        if (path === 'contexts') {
            contexts++;
            data = { id: context, projectId: project };
        }
        else if (path === 'sessions') {
            created++;
            data = session = { id, projectId: project, contextId: context, userMetadata: body.userMetadata, status: 'RUNNING', expiresAt: new Date(Date.now() + 1200000).toISOString(), connectUrl: 'wss://connect.browserbase.com/?secret=inert' };
        }
        else if (path === 'sessions/' + id)
            data = session;
        else
            throw Error('Unexpected provider path ' + path);
        return new Response(JSON.stringify(data), { status: 200 });
    };
    const env = { BROWSERBASE_PROJECT_ID: project, BROWSERBASE_API_KEY: 'inert' };
    await resolveManagedSession('owner-a', 'https://example.com', store, env, fetcher);
    unavailable = true;
    await assert.rejects(resolveManagedSession('owner-a', 'https://example.com', store, env, fetcher), /provider_unavailable/);
    assert.equal(created, 1);
    unavailable = false;
    session.status = 'COMPLETED';
    await resolveManagedSession('owner-a', 'https://example.com', store, env, fetcher);
    assert.equal(created, 2);
    assert.equal(contexts, 1);
    assert.equal(state.contexts['example.com'], context);
});
if (failures)
    process.exit(1);
