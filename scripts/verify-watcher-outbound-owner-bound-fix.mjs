// SECURITY REGRESSION: execute corrected original watcher source against sealed fictional dependencies.
// All rows, phones, messages, DB results, costs, and sends are fictional in-process objects.
// No user tables or network/provider modules are imported or invoked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fileName = 'lib/agent/watchers.ts';
const source = readFileSync(fileName, 'utf8');
const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const fn = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'sendWhatsAppIfWanted');
assert.ok(fn, 'must find the actual production sendWhatsAppIfWanted function');
const program = ts.transpileModule(fn.getText(ast), {
  fileName: 'inert-watcher-outbound.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const A = '9007199254740992';
const B = '9007199254740993';
const FAKE_A = 'whatsapp:+15555550101';
const FAKE_B = 'whatsapp:+15555550202';
const defaultRows = [
  { telegram_id: '42', whatsapp_id: 'whatsapp:+15555550042' },
  { telegram_id: '-42', whatsapp_id: 'whatsapp:+15555559942' },
  { telegram_id: A, whatsapp_id: FAKE_A },
  { telegram_id: B, whatsapp_id: FAKE_B },
];

async function runOriginal({ owner, delivery = 'whatsapp', rows = defaultRows, forcedRow = undefined }) {
  const queries = [], sends = [], costs = [];
  const backend = {
    from(table) {
      assert.equal(table, 'users', 'only fictional users table may be queried');
      return {
        select(columns) {
          assert.ok(typeof columns === 'string' && columns.includes('whatsapp_id'), 'outbound must request recipient');
          return {
            eq(column, value) {
              assert.equal(column, 'telegram_id', 'lookup must be owner-scoped');
              queries.push({ column, value, columns });
              return {
                async maybeSingle() {
                  const row = forcedRow === undefined
                    ? rows.find((candidate) => candidate.telegram_id === String(value))
                    : forcedRow;
                  return { data: row ? { ...row } : null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const context = {
    supabaseAdmin: backend,
    sendWhatsAppMessage: async (phone, message) => { sends.push({ phone, message }); },
    recordCostEvent: async (event) => { costs.push(event); },
  };
  vm.createContext(context, { name: 'synthetic-watcher-outbound' });
  vm.runInContext(program + '\nglobalThis.__watcherSend = sendWhatsAppIfWanted;', context, { timeout: 1500 });
  assert.equal(typeof context.__watcherSend, 'function', 'must run original production function');
  await context.__watcherSend(owner, delivery, 'FICTIONAL PRIVATE WATCH CONTENT');
  return { queries, sends, costs };
}

let controls = 0, mandatoryPass = 0, mandatoryFail = 0;
async function control(name, run) {
  try { await run(); controls++; console.log('PASS CONTROL ' + name); }
  catch (err) { console.error('FAIL CONTROL ' + name + ': ' + String(err?.message || err)); process.exitCode = 1; }
}
async function mandatory(name, run) {
  try { await run(); mandatoryPass++; console.log('PASS SAFETY ' + name); }
  catch (err) { mandatoryFail++; console.error('FAIL REQUIRED SAFETY ' + name + ': ' + String(err?.message || err)); }
}

await control('positive safe owner sends only to its own fictional phone', async () => {
  const r = await runOriginal({ owner: '42' });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].phone, 'whatsapp:+15555550042');
  assert.equal(r.costs.length, 1);
});
await control('valid negative safe WhatsApp owner still receives own fictional watch', async () => {
  const r = await runOriginal({ owner: '-42', delivery: 'both' });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].phone, 'whatsapp:+15555559942');
});
await control('app-only notification does not query owner or send externally', async () => {
  const r = await runOriginal({ owner: '42', delivery: 'app' });
  assert.equal(r.queries.length, 0);
  assert.equal(r.sends.length, 0);
});
await control('missing fictional owner never sends a WhatsApp notification', async () => {
  const r = await runOriginal({ owner: '44' });
  assert.equal(r.sends.length, 0);
});
await control('non-numeric owner does not query private rows', async () => {
  const r = await runOriginal({ owner: 'not-an-owner' });
  assert.equal(r.queries.length, 0);
  assert.equal(r.sends.length, 0);
});
await control('actual background watcher paths use outbound helper', async () => {
  assert.ok((source.match(/sendWhatsAppIfWanted\(/g) || []).length >= 5,
    'watcher outbound helper must be used by live background watcher handlers');
});

await mandatory('distinct 64-bit string owner B must never select A WhatsApp recipient', async () => {
  const r = await runOriginal({ owner: B });
  assert.ok(!r.sends.some((s) => s.phone === FAKE_A), 'wrong-owner WhatsApp transmission');
  assert.ok(r.queries.length === 0 || r.queries.every((q) => typeof q.value === 'string' && q.value === B),
    'unsafe 64-bit owner must be preserved exactly or fail closed BEFORE lookup');
});
await mandatory('already-rounded unsafe JS numeric owner must fail closed before lookup', async () => {
  const rounded = Number(BigInt(B));
  assert.equal(Number.isSafeInteger(rounded), false);
  const r = await runOriginal({ owner: rounded });
  assert.equal(r.queries.length, 0, 'cannot reconstruct an unsafe numeric owner identifier');
  assert.equal(r.sends.length, 0);
});
await mandatory('a returned row with a different persisted owner cannot receive a private watch', async () => {
  const r = await runOriginal({
    owner: '42', forcedRow: { telegram_id: '43', whatsapp_id: 'whatsapp:+15555550043' },
  });
  assert.equal(r.sends.length, 0, 'must bind returned user row to exact requested owner');
});
await mandatory('fractional owner must be refused before a privileged lookup', async () => {
  const r = await runOriginal({ owner: '42.5' });
  assert.equal(r.queries.length, 0, 'non-integer input must not reach service-role user query');
  assert.equal(r.sends.length, 0);
});
await mandatory('scientific numeric owner format must be refused before lookup', async () => {
  const r = await runOriginal({ owner: '4.2e1' });
  assert.equal(r.queries.length, 0, 'noncanonical owner representation must be refused');
  assert.equal(r.sends.length, 0);
});


await mandatory('exact large owner B routes only to its own fictional recipient', async () => {
  const r = await runOriginal({ owner: B });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].phone, FAKE_B);
  assert.equal(r.queries[0].value, B);
});
await mandatory('zero and negative zero are never valid account owners', async () => {
  for (const owner of ['0','-0']) {
    const r = await runOriginal({ owner });
    assert.equal(r.queries.length, 0);
    assert.equal(r.sends.length, 0);
  }
});
await mandatory('noncanonical leading-zero owner never initiates private query', async () => {
  const r = await runOriginal({ owner: '00042' });
  assert.equal(r.queries.length, 0);
  assert.equal(r.sends.length, 0);
});
await mandatory('out-of-range signed int64 string never initiates private query', async () => {
  const r = await runOriginal({ owner: '9223372036854775808' });
  assert.equal(r.queries.length, 0);
  assert.equal(r.sends.length, 0);
});
await mandatory('missing owner in recipient row must fail closed', async () => {
  const r = await runOriginal({ owner: '42', forcedRow: { whatsapp_id: FAKE_A } });
  assert.equal(r.sends.length, 0);
});
await mandatory('decoded imprecise numeric recipient row must fail closed even for matching large owner string', async () => {
  const r = await runOriginal({ owner: A, forcedRow: { telegram_id: Number(A), whatsapp_id: FAKE_A } });
  assert.equal(r.sends.length, 0);
});

console.log('Watcher outbound owner precision: ' + controls + '/6 benign controls PASS; '
  + mandatoryPass + '/11 mandatory security assertions PASS; ' + mandatoryFail + ' REQUIRED RED');
if (controls !== 6 || mandatoryPass !== 11 || mandatoryFail !== 0) process.exitCode = 1;
