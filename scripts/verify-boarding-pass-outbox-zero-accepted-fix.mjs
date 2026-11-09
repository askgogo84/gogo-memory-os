import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// All functions are extracted from the actual checked-out source and run
// against fictional DB/provider stubs; no customer data, network, push or DB.
function original(path, name, bindings) {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const node = file.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(node, 'original production function missing: ' + path + '::' + name)
  const js = ts.transpileModule(node.getText(file).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.ok(!js.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error), 'source transpile errors')
  return vm.runInNewContext(js.outputText + '\n' + name, {
    ...bindings,
    Date,
    Error,
    console: { error() {} },
    fetch: async () => { throw new Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST') },
  }, { timeout: 1000 })
}

function fakeQuery(resolve, filters = []) {
  const q = {
    select() { return q },
    eq(column, value) { filters.push([column, value]); return q },
    not() { return q },
    order() { return q },
    limit() { return q },
    then(onOk, onError) { return Promise.resolve().then(resolve).then(onOk, onError) },
  }
  return q
}

async function pushForFakeDevices(devices, lookupError = null) {
  const db = {
    from(table) {
      assert.equal(table, 'agent_devices')
      return fakeQuery(() => ({ data: devices, error: lookupError }))
    },
  }
  return original('lib/agent/push.ts', 'sendAgentPush', { supabaseAdmin: db })(
    '-73001', { title: 'Fictional flight update', body: 'No real push' }
  )
}

async function outbox(senderResult = { sent: 1, failed: 0 },
  pending = [{ id: 'fictional-notice' }],
  claimed = { telegramId: '-73001', runId: 'fictional-run', lifeEventId: 'fictional-trip', scheduleRevision: 'v1' },
  trace = { updates: [], claims: [], calls: [] }) {
  const db = {
    from(table) {
      assert.equal(table, 'boarding_pass_outbox')
      return {
        select() { return fakeQuery(() => ({ data: pending, error: null })) },
        update(payload) {
          const filters = []
          return fakeQuery(() => {
            trace.updates.push({ payload, filters })
            return { error: null, data: null }
          }, filters)
        },
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'gogo_claim_boarding_pass_notice')
      trace.claims.push(args.p_id)
      return { data: claimed, error: null }
    },
  }
  const sendAgentPush = async (id, notice) => {
    trace.calls.push({ id, runId: notice.data?.runId, title: notice.title })
    if (senderResult instanceof Error) throw senderResult
    return senderResult
  }
  await original('lib/agent/life-event-email-worker.ts', 'deliverBoardingPassNotices', {
    supabaseAdmin: db,
    sendAgentPush,
  })()
  return trace
}

function status(trace) {
  assert.equal(trace.updates.length, 1, 'one claim should get one terminal receipt')
  assert.ok(trace.updates[0].filters.some(([k, v]) => k === 'status' && v === 'claimed'),
    'terminal update must remain conditional on claimed status; no retry/requeue')
  return trace.updates[0].payload.status
}

let controls = 0, controlFailures = 0, security = 0, securityFailures = 0
async function check(label, kind, fn) {
  if (kind === 'CONTROL') controls++
  else security++
  try {
    await fn()
    console.log(kind + ' PASS: ' + label)
  } catch (e) {
    if (kind === 'CONTROL') controlFailures++
    else securityFailures++
    console.error(kind + ' FAIL: ' + label + ': ' + (e?.stack || String(e)))
  }
}

await check('no pending notice, no provider call or update', 'CONTROL', async () => {
  const r = await outbox(undefined, [])
  assert.equal(r.calls.length, 0)
  assert.equal(r.updates.length, 0)
})
await check('unclaimed notice remains untouched', 'CONTROL', async () => {
  const r = await outbox(undefined, undefined, null)
  assert.equal(r.calls.length, 0)
  assert.equal(r.updates.length, 0)
})
await check('one accepted push ticket is sent, never recipient-delivered proof', 'CONTROL', async () => {
  const r = await outbox({ sent: 1, failed: 0 })
  assert.equal(status(r), 'sent')
  assert.equal(r.calls[0].id, '-73001', 'signed WhatsApp actor remains exact')
  assert.equal(r.calls[0].runId, 'fictional-run')
})
await check('two fully accepted push tickets are sent', 'CONTROL', async () => {
  assert.equal(status(await outbox({ sent: 2, failed: 0 })), 'sent')
})
await check('definitively rejected push is failed terminally', 'CONTROL', async () => {
  assert.equal(status(await outbox({ sent: 0, failed: 1 })), 'failed')
})

await check('no registered device never yields sent receipt', 'SAFETY', async () => {
  const observed = await pushForFakeDevices([])
  assert.equal(observed.sent, 0)
  assert.equal(observed.failed, 0)
  assert.equal(status(await outbox(observed)), 'failed')
})
await check('device-lookup failure never yields sent receipt', 'SAFETY', async () => {
  const observed = await pushForFakeDevices([], { message: 'fictional DB error' })
  assert.equal(observed.sent, 0)
  assert.equal(observed.failed, 0)
  assert.equal(status(await outbox(observed)), 'failed')
})
await check('blank device token never yields sent receipt', 'SAFETY', async () => {
  const observed = await pushForFakeDevices([{ id: 'fake-device', expo_push_token: '   ' }])
  assert.equal(observed.sent, 0)
  assert.equal(observed.failed, 0)
  assert.equal(status(await outbox(observed)), 'failed')
})
await check('zero accepted, zero failed counters never imply provider acceptance', 'SAFETY', async () => {
  assert.equal(status(await outbox({ sent: 0, failed: 0 })), 'failed')
})
await check('partially accepted provider batch is not reported fully sent', 'SAFETY', async () => {
  assert.equal(status(await outbox({ sent: 1, failed: 1 })), 'failed')
})
await check('invalid untrusted push counter cannot claim sent', 'SAFETY', async () => {
  assert.equal(status(await outbox({ sent: '1', failed: 0 })), 'failed')
})
await check('throwing transport never updates terminal state or auto-retries', 'SAFETY', async () => {
  const trace = { updates: [], claims: [], calls: [] }
  await assert.rejects(
    () => outbox(new Error('fictional uncertain provider outcome'), undefined, undefined, trace),
    /fictional uncertain provider outcome/
  )
  assert.equal(trace.calls.length, 1)
  assert.equal(trace.claims.length, 1)
  assert.equal(trace.updates.length, 0, 'leave original claim unresolved; no blind retry')
})

console.log('SUMMARY ' + (controls - controlFailures) + '/' + controls
  + ' positive controls; ' + (security - securityFailures) + '/' + security
  + ' mandatory source-level safety assertions; no providers or private data')
if (controlFailures) {
  console.error('INVALID HARNESS: control regression, do not infer security correctness')
  process.exitCode = 2
} else if (securityFailures) {
  console.error('MANDATORY SAFETY FAILED: DO NOT MERGE OR DEPLOY')
  process.exitCode = 1
}
