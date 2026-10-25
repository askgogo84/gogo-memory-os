# AskGogo — provider anti-bot challenge handoff

**1 Sep 2026 · work stopped mid-session on credit exhaustion · uncommitted**

Context for whoever picks this up. Everything in §2 was verified live. Everything
in §4 is inferred from the session transcript, not from reading the repo, and
should be confirmed before acting on it.

---

## 1. The problem

A BookMyShow ticket URL opens normally in the user's Android Chrome. The same URL
in our Vercel Sandbox Playwright browser returns Cloudflare's interstitial. The
block is datacenter-IP reputation, not a missing credential, so it cannot be
retried into success from the server.

**Explicit non-goal: no bypass.** No UA rotation, no cookie replay, no proxying,
no reading internal APIs with a `__cf_bm` cookie. Detection is observational only.
Anything in this document that looks like it needs an evasion step is wrong and
should be raised rather than implemented.

---

## 2. Investigation findings — live, verified

From `https://bmsurl.co/BMSTNY/5Mjc6DKmzL`:

- **The redirect chain is server-safe.** `bmsurl.co/…` → 301 →
  `in.bookmyshow.com/tiny/5Mjc6DKmzL`. The 301 itself is not challenged, so the
  resolved deep link is obtainable server-side.
- **The resolved page is hard-blocked.** HTTP **403**, `server: cloudflare`,
  title `Attention Required! | Cloudflare`, body contains "Sorry, you have been
  blocked", a Ray ID, and "Please enable cookies".
- **No structured data.** `ogTags(0)`, `jsonLd(0)`. The challenge page exposes no
  OG, no JSON-LD, no deep-link payload, no API response.
- **The `/tiny/…` slug is opaque** and carries no booking parameters.

**Conclusion: no server-safe route exposes the booking.** The only legitimate
routes are (a) the redirect-resolved deep link, opened on the user's already
signed-in device, and (b) the connected-Gmail confirmation, which is already
integrated.

---

## 3. What was implemented before the session stopped

Four files, **uncommitted**. Confirm with `git status` before anything else.

| File | Change |
|---|---|
| `lib/agent/provider-challenge.ts` | NEW, 79 lines. Exports `detectProviderChallenge`, `isCloudflareHttpChallenge`, `PROVIDER_CLOUDFLARE_CHALLENGE`, `DEVICE_HANDOFF_REQUIRED` |
| `scripts/verify-provider-challenge.mts` | NEW, 62 lines. Unit checks on the detector and the shared constants |
| `lib/agent/secure-ticket-reader.ts` | Import added; `blockReason` union widened; `handoff?: 'device_handoff_required'` added; challenge check inserted before the human-auth gate |
| `lib/agent/secure-computer.ts` | Same three changes in `runSecureBrowser`, plus a `sandbox.stop()` on the blocked path |

Both call sites check the challenge **before** `detectHumanAuthGate`, which is
correct: a Cloudflare block is not a human-auth pause and must not be surfaced as
one.

The `secure-computer.ts` fallback needed its own check because it runs in the same
sandbox and therefore the same blocked IP. That reasoning is sound and the edit
landed.

---

## 4. What remains — and this is the actual bug

### 4.1 The retry loop was never touched

The session's own finding: **`booking-change-watch` re-runs
`readProviderTicketPage` every 6 hours and defers forever on non-completion.**
That loop is the reason the work started.

Four files were edited. `booking-change-watch` was not one of them.

So the current state is a detector that sets `handoff: 'device_handoff_required'`
and **nothing on the retry path reads it**. The watcher still re-hits an IP that
Cloudflare has hard-blocked, every six hours, indefinitely. The symptom the work
was meant to remove is still fully present.

Required: when a watched booking returns `blockReason ===
'provider_cloudflare_challenge'`, the watcher must **stop re-running the read**
rather than defer. Stopping is not failing — the booking stays tracked, it just
stops being polled through a route that cannot succeed. Decide and document
whether a later user-initiated retry can re-arm it.

### 4.2 The HTTP signal is being dropped before the detector sees it

The live check observed three machine-readable signals: HTTP **403**,
`server: cloudflare`, and a Ray ID header.

Both call sites pass only `{ title: page.title, text: page.text }`. So the
detector is matching on Cloudflare's interstitial **copy**, which is localised and
changes between Cloudflare releases — the least durable of the three signals.

That `isCloudflareHttpChallenge` exists as a separate export suggests the HTTP path
is already written and simply not wired at either call site. Confirm, then plumb
status code and response headers through to it.

### 4.3 403 and 503 are different and should not be logged as one thing

- **403 + "you have been blocked"** — IP reputation. Permanent from this sandbox.
  Will never pass. Hand off, stop retrying.
- **503 + "Checking your browser" / managed challenge** — JS challenge. Sometimes
  passes on a legitimate retry.

Both should hand off to the device. But collapsing them into one reason code hides
which providers are permanently closed to us versus transiently slow, and that
distinction is what tells you later whether the sandbox IP needs attention at all.

---

## 5. Verification

```
cd C:\Users\gover\gogo-memory-os
git status --short --branch
git diff --stat
npx tsc --noEmit
npx tsx scripts/verify-provider-challenge.mts
```

Then whatever the repo's full test command is — confirm from `package.json`
rather than assuming.

Do not run the live URL check again as part of routine verification. One
read-only GET during investigation is reasonable; a repeated automated hit
against a provider that has already blocked us is not.

---

## 6. Suggested order

1. `git status`, confirm the four files, commit as WIP so nothing is lost.
2. `tsc --noEmit` and the verify script — the `secure-computer.ts` edits went in
   after a failed first attempt, so the file is worth a read.
3. **Wire the handoff into `booking-change-watch`.** This is the fix.
4. Plumb the HTTP status and headers into the detector; split 403 from 503.
5. Confirm the user-facing surfacing layer renders the handoff as "open this on
   your phone" and not as a generic failure or a login prompt.
