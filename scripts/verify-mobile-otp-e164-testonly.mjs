// Inert actual-module regression for desktop WhatsApp OTP pairing. This deliberately
// cannot access a network, Supabase, real user, real OTP delivery or process secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('lib/mobile-auth/otp.ts', 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'otp.ts',
}).outputText;
const INDIA = '9876543210'; // entirely fictional test identifier
const INDIA_E164 = '+91' + INDIA;
const UK_E164 = '+447700900123'; // fictional foreign control

function harness({ users = [], count = 0, senderFails = false } = {}) {
  const sent = [], inserted = [], expired = [], userLookups = [], rateLookups = [];
  const supabaseAdmin = {
    from(table) {
      if (!['mobile_link_requests', 'users'].includes(table)) throw Error('Unexpected fixture table');
      const state = { op: 'read', predicates: {}, candidates: [], countHead: false, insert: null, update: null };
      const q = {
        select(_columns, options) { if (options?.head) state.countHead = true; return q; },
        eq(column, value) { state.predicates[column] = value; return q; },
        gte() { return q; },
        in(column, values) { if (column !== 'whatsapp_id') throw Error('Unexpected owner predicate'); state.candidates = values; return q; },
        limit() { return q; },
        insert(value) { state.op = 'insert'; state.insert = value; inserted.push(value); return q; },
        update(value) { state.op = 'update'; state.update = value; return q; },
        async single() {
          if (table !== 'mobile_link_requests' || state.op !== 'insert') throw Error('Unexpected fixture single');
          return { data: { id: 'fictional-link-' + inserted.length }, error: null };
        },
        then(resolve, reject) {
          let value;
          if (table === 'mobile_link_requests' && state.countHead) {
            rateLookups.push(state.predicates.whatsapp_id);
            value = { count, error: null };
          } else if (table === 'users') {
            userLookups.push(state.candidates);
            value = { data: users.filter(u => state.candidates.includes(u.whatsapp_id)).slice(0, 1), error: null };
          } else if (table === 'mobile_link_requests' && state.op === 'update') {
            expired.push({ ...state.predicates, ...state.update });
            value = { error: null };
          } else {
            throw Error('Unexpected fixture query');
          }
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const exports = {};
  runInNewContext(js, {
    exports,
    require(id) {
      if (id === 'crypto' || id === 'node:crypto') return require('node:crypto');
      if (id === '@/lib/supabase-admin') return { supabaseAdmin };
      if (id === '@/lib/channels/whatsapp') return {
        sendWhatsAppMessage: async (to, message) => {
          sent.push({ to, codeShapedMessage: /Your code is \*\d{6}\*/.test(message) });
          if (senderFails) throw Error('fictional_sender_outage');
        },
      };
      throw Error('Unexpected dependency: ' + id);
    },
    console: { error: () => {} },
    Date,
    Buffer,
    process: { env: {} },
  }, { filename: 'transpiled-otp-fixture.js', timeout: 5000 });
  return { otp: exports, sent, inserted, expired, userLookups, rateLookups };
}

const checks = [];
const test = (name, fn) => checks.push({ name, fn });

// Benign controls protect supported behavior and non-enumeration.
test('control: explicit +91 keeps the correct persisted account and sends via injected fake sender', async () => {
  const h = harness({ users: [{ id: 'fictional-india-owner', whatsapp_id: INDIA_E164 }] });
  assert.equal(h.otp.normalizeWhatsappLogin('+91 ' + INDIA), INDIA_E164);
  const result = await h.otp.startWhatsappOtpLink({ whatsappNumber: INDIA_E164, platform: 'android' });
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].user_id, 'fictional-india-owner');
  assert.equal(h.inserted[0].whatsapp_id, INDIA_E164);
  assert.deepEqual(h.sent, [{ to: INDIA_E164, codeShapedMessage: true }]);
  assert.match(result.message, /^If this WhatsApp number is linked/);
});
test('control: explicit international number keeps its country prefix', async () => {
  const h = harness({ users: [{ id: 'fictional-uk-owner', whatsapp_id: UK_E164 }] });
  assert.equal(h.otp.normalizeWhatsappLogin(UK_E164), UK_E164);
  await h.otp.startWhatsappOtpLink({ whatsappNumber: UK_E164, platform: 'ios' });
  assert.equal(h.inserted[0].user_id, 'fictional-uk-owner');
  assert.deepEqual(h.sent.map(v => v.to), [UK_E164]);
});
test('control: unknown user gets same non-enumerating message and zero provider sends', async () => {
  const registered = harness({ users: [{ id: 'fictional-india-owner', whatsapp_id: INDIA_E164 }] });
  const unknown = harness();
  const valid = await registered.otp.startWhatsappOtpLink({ whatsappNumber: INDIA_E164, platform: 'android' });
  const notFound = await unknown.otp.startWhatsappOtpLink({ whatsappNumber: INDIA_E164, platform: 'android' });
  assert.equal(notFound.message, valid.message);
  assert.equal(unknown.sent.length, 0);
  assert.equal(unknown.inserted[0].user_id, null);
});
test('control: short malformed input never reaches the database or sender', async () => {
  const h = harness();
  await assert.rejects(() => h.otp.startWhatsappOtpLink({ whatsappNumber: '123', platform: 'ios' }), /invalid_whatsapp_number/);
  assert.equal(h.rateLookups.length, 0);
  assert.equal(h.sent.length, 0);
});
test('control: per-number hourly rate limit remains enforced', async () => {
  const h = harness({ count: 4 });
  await assert.rejects(() => h.otp.startWhatsappOtpLink({ whatsappNumber: INDIA_E164, platform: 'ios' }), /too_many_codes/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.inserted.length, 0);
});
test('control: fictional sender outage cannot reveal account existence or claim confirmed delivery', async () => {
  const h = harness({ users: [{ id: 'fictional-india-owner', whatsapp_id: INDIA_E164 }], senderFails: true });
  const result = await h.otp.startWhatsappOtpLink({ whatsappNumber: INDIA_E164, platform: 'ios' });
  assert.match(result.message, /^If this WhatsApp number is linked/);
  assert.equal(h.expired.length, 1);
  assert.equal(h.expired[0].status, 'expired');
});

// Mandatory owner-binding acceptance: these currently FAIL on shipped production code.
test('MANDATORY: bare India-local 10 digits resolve to canonical +91 identity', async () => {
  assert.equal(harness().otp.normalizeWhatsappLogin(INDIA), INDIA_E164);
});
test('MANDATORY: bare 10-digit OTP pairs the existing +91 owner, not a phantom account', async () => {
  const h = harness({ users: [{ id: 'fictional-india-owner', whatsapp_id: INDIA_E164 }] });
  await h.otp.startWhatsappOtpLink({ whatsappNumber: INDIA, platform: 'android' });
  assert.equal(h.inserted[0].whatsapp_id, INDIA_E164, 'pending request must have canonical owner identifier');
  assert.equal(h.inserted[0].user_id, 'fictional-india-owner', 'pending request must be owner-bound');
});
test('MANDATORY: bare 10-digit matched account triggers exactly one fake E.164 OTP send', async () => {
  const h = harness({ users: [{ id: 'fictional-india-owner', whatsapp_id: INDIA_E164 }] });
  await h.otp.startWhatsappOtpLink({ whatsappNumber: INDIA, platform: 'android' });
  assert.deepEqual(h.sent, [{ to: INDIA_E164, codeShapedMessage: true }]);
});

let passed = 0;
let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    passed++;
    console.log('PASS', name);
  } catch (err) {
    failed++;
    console.error('FAIL', name, '-', String(err?.message || err).slice(0, 300));
  }
}
console.log('Synthetic mobile OTP E.164: ' + passed + ' passed, ' + failed + ' failed; no real network, users or sends.');
if (failed) process.exitCode = 1;
