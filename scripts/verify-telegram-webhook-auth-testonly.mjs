// TEST ONLY. Execute the unchanged production Telegram webhook in a sealed VM.
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
  const fakeDeps = {
    'next/server': { NextResponse: { json: jsonReply } },
    'node:crypto': localRequire('node:crypto'),
    '@/lib/bot/process-message': {
      processIncomingMessage: async () => { events.push('agent'); return { text: 'inert-fixture-reply' }; },
    },
    '@/lib/bot/resolve-user': {
      resolveUser: async () => {
        events.push('resolve_user');
        return { userId: 'fictional-owner', telegramId: 424242, name: 'Fixture', whatsappId: null };
      },
    },
    '@/lib/agent/brain-runtime-guard': {
      claimInboundEvent: async () => {
        events.push('claim_inbound');
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
      sendTelegramMessage: async () => { events.push('send_message'); return { result: { message_id: 9 } }; },
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
  return { events, response };
}

const tests = [];
const test = (title, fn) => tests.push({ title, fn });

function denyBeforeSideEffects(result, allowedStatuses = [401, 403]) {
  assert.ok(allowedStatuses.includes(result.response.status), 'must reject unauthenticated webhook with an explicit non-2xx status');
  assert.deepEqual(result.events, [], 'must reject before parsing body, claiming a run, resolving a user or sending anything');
}

// Benign controls must remain green when a real authenticity guard is introduced.
test('control: correct synthetic header permits a single inert text delivery path', async () => {
  const r = await exercise({ header: FAKE_SECRET });
  assert.equal(r.response.status, 200);
  assert.deepEqual(r.events, [
    'parse_body', 'claim_inbound', 'resolve_user', 'brain_lease',
    'agent', 'send_message', 'complete_inbound', 'release_lease',
  ]);
});
test('control: duplicate signed event never re-runs the actor or sends a reply', async () => {
  const r = await exercise({ header: FAKE_SECRET, duplicate: true });
  assert.equal(r.response.body.duplicate, true);
  assert.deepEqual(r.events, ['parse_body', 'claim_inbound']);
});
test('control: signed no-message event is harmless and does not resolve an owner', async () => {
  const r = await exercise({ header: FAKE_SECRET, body: { update_id: 13579 } });
  assert.equal(r.response.body.skipped, 'no message');
  assert.deepEqual(r.events, ['parse_body']);
});
test('control: correctly signed unsupported message uses only the existing inert reply', async () => {
  const r = await exercise({
    header: FAKE_SECRET,
    body: { update_id: 13580, message: { chat: { id: 424242 }, message_id: 74, photo: [{ file_id: 'fictional' }] } },
  });
  assert.equal(r.response.body.skipped, 'unsupported message type');
  assert.deepEqual(r.events, ['parse_body', 'claim_inbound', 'resolve_user', 'brain_lease', 'send_message', 'complete_inbound', 'release_lease']);
});

// Mandatory security gates deliberately fail against the currently deployed route.
// None of these requests leave this VM or contact a Telegram endpoint.
test('MANDATORY: missing verification configuration fails closed before reading body', async () => {
  denyBeforeSideEffects(await exercise({ configured: null, header: FAKE_SECRET }), [500, 503]);
});
test('MANDATORY: missing Telegram secret header is refused before any owner lookup', async () => {
  denyBeforeSideEffects(await exercise({ header: undefined }));
});
test('MANDATORY: incorrect same-length synthetic header is refused without side effects', async () => {
  denyBeforeSideEffects(await exercise({ header: 'Z'.repeat(FAKE_SECRET.length) }));
});
test('MANDATORY: header with correct prefix and trailing character is refused', async () => {
  denyBeforeSideEffects(await exercise({ header: FAKE_SECRET + 'x' }));
});
test('MANDATORY: header containing a valid token as substring is refused', async () => {
  denyBeforeSideEffects(await exercise({ header: 'x' + FAKE_SECRET }));
});
test('MANDATORY: empty Telegram secret header is refused before body parse', async () => {
  denyBeforeSideEffects(await exercise({ header: '' }));
});

let passed = 0, failed = 0;
for (const { title, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log('PASS', title);
  } catch (e) {
    failed++;
    console.error('FAIL', title, '-', String(e?.message || e).slice(0, 250));
  }
}
console.log('Telegram webhook auth synthetic suite: ' + passed + ' pass, ' + failed + ' fail. No network/DB/provider activity.');
if (failed) process.exitCode = 1;
