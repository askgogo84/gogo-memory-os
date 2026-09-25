# Same Brain v2 production acceptance

The Brain surface is `/dashboard/brain`, with JSON at `/api/dashboard/brain?hours=168`.
It uses the signed-in dashboard session. Neither endpoint accepts a target user ID.
Desktop: Brain navigation. Mobile: You → Brain & Autonomy.

## Regression commands

Run from the repository root. Fixture credentials do not access a real database.

```bash
npm ci
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co SUPABASE_SERVICE_ROLE_KEY=fixture node --import tsx scripts/verify-brain-introspection.ts
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co SUPABASE_SERVICE_ROLE_KEY=fixture node --import tsx scripts/verify-calendar-presentation.ts
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co SUPABASE_SERVICE_ROLE_KEY=fixture node --import tsx scripts/verify-brain-dashboard.ts
```

The full CI gate runs `npm test`, `npm run typecheck`, and `npm run build` with fixture credentials. It includes the existing guarded-learning, correction/replacement, provider readback, outcome reconciliation, approval, unknown-outcome and Gmail execution regressions.

## Read-only authenticated production checks

Open `https://app.askgogo.in/dashboard/brain` and sign in normally. Paste this into that site's browser developer console. It uses the existing session without reading or exporting cookies. The three chat requests are reads; they add ordinary conversation history. Never supply service-role keys or production secrets.

```javascript
await (async () => {
  const reportResponse = await fetch('/api/dashboard/brain?hours=168', {credentials:'same-origin', cache:'no-store'});
  if (!reportResponse.ok) throw new Error(`Brain report HTTP ${reportResponse.status}`);
  const report = await reportResponse.json();
  console.log('Measured production evidence', report);
  const prompts = [
    'How is Same Brain learning from my outcomes? Show guarded-live and shadow-only routing confidence.',
    'What do I have on my calendar tomorrow?',
    'What do I have tomorrow?'
  ];
  for (const text of prompts) {
    const response = await fetch('/api/dashboard/chat', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})
    });
    if (!response.ok) throw new Error(`Chat HTTP ${response.status}`);
    const reply = await response.json();
    console.log(text, reply);
    if (reply.readOnly !== true || reply.mutated !== false) throw new Error('Read-only contract missing');
    if (text.includes('Same Brain') && reply.handledBy !== 'same-brain-introspection') throw new Error('Introspection route missed');
    if (text.includes('on my calendar') && /^(?:Reminders:|Needs your attention:)/m.test(reply.text)) throw new Error('Calendar includes another source');
  }
})();
```

Check against Google Calendar for the user's local tomorrow, including all-day events. Check that pending reminders are unchanged. Verify combined agenda includes relevant pending reminders while explicit Calendar does not. Repeat these exact prompts in WhatsApp to verify Twilio ingress and outbound delivery. Then check desktop and mobile Brain rendering and its 24-hour, 7-day and 30-day selectors.

The introspection read uses at most 250 learning/observation rows over 7 days. The dashboard uses at most 1,000 activity rows and reports its own limits. Different sample caps can yield different counts; neither is a lifetime total.

## Authentication and isolation

Without cookies, this must return HTTP 401 and `Cache-Control: private, no-store`:

```bash
curl -i 'https://app.askgogo.in/api/dashboard/brain?hours=168'
```

Use two separately signed-in test accounts to confirm each sees only its own learning events. Query-string `telegramId` or `userId` parameters must not change the tenant. Never compare raw private provider payloads in shared logs.

## Learning after a production read

Send a harmless Calendar or Gmail read in the test account. Inspect the Brain report for a new learning event and its actual evidence status. Provider-verified success must require provider proof. A wrong-handler correction must record negative evidence for that handler and replacement evidence for the corrected route; replacement alone is not completion. An ambiguous question should record clarification evidence if clarification occurs. Do not fabricate a success to make a metric improve.

Use fixtures for consequential-action acceptance: approval binding, provider send/readback failure, outcome_unknown and retries. Do not send consequential email, buy, pay or book merely to exercise a dashboard metric.

## Measurement limits

- Rates are over observed decision/handler outcomes, not all lifetime tasks.
- Legacy events without decision IDs cannot be deduplicated; their count is visible.
- First-route accuracy is available only for explicitly judged routes.
- Guarded-live observations are hints, not evidence of completed execution or permissions.
- Calibrated confidence uses provider-verified completion and the 95% Wilson lower bound; at least 20 identified samples are required.
- Jev totals include explicitly attempted calls and show token measurement coverage.
- Model metrics currently cover recorded general-plan SDK invocations. Specialist model calls and whole-task model/token/cost totals remain unavailable.
- Estimated cost requires recorded operator-configured rates. No current price is inferred.
- Task averages show measured/linked task counts, truncation and approval-wait inclusion.
- Daily evidence uses UTC event-day cohorts. Cross-day corrections prevent interpreting the table as a cumulative success curve or causal improvement claim.

No schema migration, permission expansion, approval bypass, provider-verification bypass, or unknown-mutation retry is introduced by this surface.
