// SECURITY FIX REGRESSION. Execute the corrected Telegram webhook in a sealed VM.
// No HTTP calls, database connections, provider messages, users, or secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const localRequire = createRequire(import.meta.url);
const ts = localRequire('typescript');
const source = readFileSync('app/api/webhooks/telegram/route.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'route.ts',
}).outputText;

const FAKE_SECRET = 'inert-telegram-fixture-secret-not-a-token';
const FAKE_MESSAGE = {
  update_id: 246801,
  message: { chat: { id: 424242 }, from: { first_name: 'Fixture' }, message_id: 73, text: 'synthetic test, no action' },
};
const jsonReply = (body, init = {}) => ({ status: init.status ?? 200, body });

async function exercise({ configured = FAKE_SECRET, header, body = FAKE_MESSAGE, duplicate = false } = {}) {
  const events = [];
  const ids = { claimed: [], resolved: [], sent: [] };
  const fakeDeps = {
    'node:crypto': localRequire('node:crypto'),
    'next/server': { NextResponse: { json: jsonReply } },
    '@/lib/bot/process-message': {
      processIncomingMessage: async () => { events.push('agent'); return { text: 'inert-fixture-reply' }; },
    },
    '@/lib/bot/resolve-user': {
      resolveUser: async (args) => {
        events.push('resolve_user');
        ids.resolved.push(args.externalUserId);
        return { userId: 'fictional-owner', telegramId: 424242, name: 'Fixture', whatsappId: null };
      },
    },
    '@/lib/agent/brain-runtime-guard': {
      claimInboundEvent: async (args) => {
        events.push('claim_inbound');
        ids.claimed.push(args.externalUserId);
        return { id: 'fixture-claim', ownerToken: 'fixture-owner-token', duplicate, status: duplicate ? 'completed' : 'claimed' };
      },
      acquireBrainUserLease: async () => { events.push('brain_lease'); return { ownerToken: 'lease-fixture' }; },
      completeInboundEvent: async () => { events.push('complete_inbound'); },
      failInboundEvent: async () => { events.push('fail_inbound'); },
      releaseBrainUserLease: async () => { events.push('release_lease'); },
    },
    '@/lib/channels/telegram': {
      deleteTelegramMessage: async () => { events.push('delete_send'); },
      sendTelegramAnimation: async () => { events.push('send_animation'); return { result: { message_id: 8 } }; },
      sendTelegramChatAction: async () => { events.push('send_chat_action'); },
      sendTelegramMessage: async (chat) => { events.push('send_message'); ids.sent.push(chat); return { result: { message_id: 9 } }; },
    },
    '@/lib/whisper': {
      downloadTelegramFile: async () => { events.push('download_voice'); return new Uint8Array(); },
      transcribeVoice: async () => { events.push('transcribe_voice'); return 'fixture'; },
    },
    '@/lib/bot/detect-intent': { detectIntent: () => ({ type: 'generic' }) },
    '@/lib/bot/status-message': {
      getStatusText: () => 'fixture',
      shouldUseAnimation: () => false,
    },
  };
  const mod = { exports: {} };
  runInNewContext(code, {
    exports: mod.exports,
    module: mod,
    require(id) {
      if (!Object.prototype.hasOwnProperty.call(fakeDeps, id)) throw Error('Unexpected module dependency in isolated test: ' + id);
      return fakeDeps[id];
    },
    process: { env: configured === null ? {} : { TELEGRAM_WEBHOOK_SECRET: configured } },
    console: { error: () => {}, log: () => {} },
    Date,
    setTimeout: () => { throw Error('Unexpected real timer'); },
    clearTimeout: () => {},
  }, { filename: 'isolated-telegram-route.js', timeout: 5000 });

  const request = {
    headers: { get(key) { return key.toLowerCase() === 'x-telegram-bot-api-secret-token' ? (header ?? null) : null; } },
    async json() { events.push('parse_body'); return body; },
  };
  const response = await mod.exports.POST(request);
  return { events, ids, response };
}

const tests = [];
const test = (title, fn) => tests.push({ title, fn });

const bodyFor = (id) => ({
  update_id: 246802,
  message: { chat: { id }, from: { first_name: 'Fixture' }, message_id: 74, text: 'synthetic no-action test' },
});

test('control: signed valid Telegram user id traverses isolated mocked flow', async () => {
  const r = await exercise({ header: FAKE_SECRET });
  assert.equal(r.response.status, 200);
  assert.deepEqual(r.events, [
    'parse_body', 'claim_inbound', 'resolve_user', 'brain_lease',
    'agent', 'send_message', 'complete_inbound', 'release_lease',
  ]);
});

test('control: duplicate signed Telegram event is not processed twice', async () => {
  const r = await exercise({ header: FAKE_SECRET, duplicate: true });
  assert.equal(r.response.body.duplicate, true);
  assert.deepEqual(r.events, ['parse_body', 'claim_inbound']);
});

test('control: signed update without chat id is ignored as before', async () => {
  const r = await exercise({ header: FAKE_SECRET, body: { update_id: 246803 } });
  assert.equal(r.response.body.skipped, 'no message');
  assert.deepEqual(r.events, ['parse_body']);
});

test('control: missing secret header remains blocked before body access', async () => {
  const r = await exercise({ header: 'wrong-fixture-secret' });
  assert.equal(r.response.status, 401);
  assert.deepEqual(r.events, []);
});

for (const id of [
  -1001234567890, -424242, 1, 424242, Number.MAX_SAFE_INTEGER,
  '-1001234567890', '-424242', '1', '424242', '9007199254740991',
]) {
  test('control: exact compatible chat identity ' + String(id), async () => {
    const r = await exercise({ header: FAKE_SECRET, body: bodyFor(id) });
    assert.equal(r.response.status, 200, 'canonical owner must be allowed');
    assert.deepEqual(r.ids.claimed, [String(id)], 'inbound ledger must receive exact canonical owner');
    assert.deepEqual(r.ids.resolved, [String(id)], 'resolver must receive exact canonical owner');
    assert.deepEqual(r.ids.sent, [Number(id)], 'send must target the same safe Telegram chat');
    assert.deepEqual(r.events, [
      'parse_body', 'claim_inbound', 'resolve_user', 'brain_lease',
      'agent', 'send_message', 'complete_inbound', 'release_lease',
    ]);
  });
}

for (const [label, id] of [
  ['zero', 0], ['negative zero', -0], ['string zero', '0'],
  ['missing id null', null], ['not-a-number', NaN], ['infinity', Infinity],
  ['fraction', 42.5], ['rounded large positive', Number.MAX_SAFE_INTEGER + 1],
  ['rounded large negative', Number.MIN_SAFE_INTEGER - 1],
  ['out-of-range signed bigint string', '9223372036854775807'],
  ['negative signed bigint string', '-9223372036854775808'],
  ['leading zero', '042'], ['negative leading zero', '-042'],
  ['whitespace prefix', ' 42'], ['whitespace suffix', '42 '],
  ['positive sign', '+42'], ['negative zero string', '-0'],
  ['decimal string', '42.0'], ['scientific string', '4.2e1'],
  ['prefix parse target', '42garbage'], ['hex string', '0x2a'],
  ['unicode fullwidth digits', '４２'], ['unicode minus', '−42'],
  ['empty string', ''], ['boolean', true], ['array', [42]], ['object', { id: 42 }],
  ['unsafe decimal string', '9007199254740992'],
]) {
  test('MANDATORY: reject ' + label + ' before claim, lookup or send', async () => {
    const r = await exercise({ header: FAKE_SECRET, body: bodyFor(id) });
    assert.equal(r.response.status, 400, 'invalid chat identity must not get a success response');
    assert.equal(r.response.body.error, 'invalid_telegram_chat_id');
    assert.deepEqual(r.events, ['parse_body'],
      'invalid owner must not claim, resolve, lease, create, process or send');
    assert.deepEqual(r.ids, { claimed: [], resolved: [], sent: [] });
  });
}

let passed = 0;
for (const { title, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log('PASS', title);
  } catch (error) {
    console.error('FAIL', title, error);
    process.exitCode = 1;
  }
}
console.log('Telegram exact webhook chat identity: ' + passed + '/' + tests.length +
  ' offline source-executing checks. No provider/DB/account/network activity.');
