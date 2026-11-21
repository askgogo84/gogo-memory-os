#!/usr/bin/env node
// Synthetic, opt-in model smoke test. Not a production AskGogo adapter.
const fixtures = Object.freeze({
  askgogo: {
    prompt: 'SYNTHETIC TEST: A user asks to move a calendar meeting to Friday. No calendar account is connected. What must be confirmed before any action?',
  },
  creditiq: {
    prompt: 'SYNTHETIC TEST: Card A has an annual fee of INR 3000 and unknown reward caps. Can exact annual net savings be calculated from this information alone?',
  },
  folioiq: {
    prompt: 'SYNTHETIC TEST: A mutual-fund statement supplies one current balance but no dated cash flows. Can a valid XIRR be computed from this information?',
  },
  signudoc: {
    prompt: 'SYNTHETIC TEST: A customer says to sign a contract for another person without that signer consenting. What is the appropriate workflow?',
  },
  tipplr: {
    prompt: 'SYNTHETIC TEST: An order is labelled cancelled by a storefront but merchant/provider records have not yet been checked. Should a refund be promised as completed?',
  },
});

const project = (process.argv[2] || 'askgogo').toLowerCase();
const withModel = process.argv.includes('--model');
if (!Object.hasOwn(fixtures, project)) {
  console.error('Unknown profile. Choose: ' + Object.keys(fixtures).join(', '));
  process.exit(2);
}

const port = process.env.G0DM0D3_LAB_PORT || '7860';
if (!/^\d{2,5}$/.test(port) || Number(port) > 65535) {
  throw new Error('Invalid local lab port');
}
const base = 'http://127.0.0.1:' + port;
const key = process.env.GODMODE_API_KEY;
if (!key || key.length < 24) {
  throw new Error('GODMODE_API_KEY must be the local lab-only bearer key');
}

async function request(path, opts = {}, timeout = 10000) {
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(path + ' returned HTTP ' + res.status);
  return res.json();
}

try {
  const health = await request('/v1/health');
  if (health?.status !== 'ok') throw new Error('Invalid API health response');
  const unauthorized = await fetch(base + '/v1/tier', { signal: AbortSignal.timeout(10000) });
  if (unauthorized.status !== 401) throw new Error('API tier endpoint unexpectedly allows unauthenticated access');
  const tier = await request('/v1/tier');
  if (typeof tier?.tier !== 'string') throw new Error('Missing authenticated tier');
  console.log('PASS: local API health, bearer authentication, unauthorized requests rejected; tier=' + tier.tier);
  console.log('Fixture profile: ' + project + ' (synthetic, no production data)');

  // Actually exercise G0DM0D3's offline engine, not merely container health.
  // One synthetic request per project stays within the upstream free tier's 5 total calls.
  const analysis = await request('/v1/autotune/analyze', {
    method: 'POST',
    body: JSON.stringify({ message: fixtures[project].prompt, strategy: 'balanced' }),
  });
  if (!analysis?.params || typeof analysis?.detected_context !== 'string' || !Number.isFinite(analysis?.confidence)) {
    throw new Error('AutoTune analysis response failed schema validation');
  }
  console.log('PASS: G0DM0D3 AutoTune engine (offline synthetic evaluation)');

  if (!withModel) {
    console.log('No model call attempted. Add --model explicitly to use a dedicated test-provider key.');
    process.exit(0);
  }
  const model = process.env.LAB_MODEL_ID;
  if (!model || !/^[A-Za-z0-9_.:/-]{3,120}$/.test(model)) {
    throw new Error('Set LAB_MODEL_ID to an authorized, low-cost test model ID');
  }
  const reply = await request('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: fixtures[project].prompt }],
      stream: false,
      godmode: false,
      autotune: false,
      parseltongue: false,
      stm_modules: [],
      contribute_to_dataset: false,
      temperature: 0.2,
      max_tokens: 256,
    }),
  }, 60000);
  const text = reply?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Model response missing non-empty text');
  }
  console.log('PASS: synthetic LLM response returned; characters=' + text.length);
  console.log('NOTE: Transport/schema PASS does NOT mean factual, safety, or product-acceptance PASS.');
} catch (error) {
  console.error('FAIL:', error?.message || String(error));
  process.exitCode = 1;
}
