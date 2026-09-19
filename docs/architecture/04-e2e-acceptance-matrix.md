# AskGogo — Run 4 E2E Acceptance Matrix

**Frozen:** 19 September 2026  
**Purpose:** One acceptance contract for AskGogo across WhatsApp, autonomous runtime, Google Workspace, browser execution, memory/documents, approvals, background work and dashboard surfaces.

## Evidence states

- **PROVEN** — observed in production or verified by a green production-gated test.
- **CODE** — implemented in source, but the named end-to-end user flow has not been observed in production.
- **UNVERIFIED** — expected behavior only. It is not launch evidence.
- **BLOCKED** — cannot be accepted until the named dependency is resolved.
- Never upgrade a row from CODE/UNVERIFIED to PROVEN without new evidence.

## Global pass rules

Every E2E case must satisfy all applicable rules:

1. **Correct specialist owns the request.** No upstream substring/prefix matcher may hijack it.
2. **Private context stays scoped to the authenticated user.**
3. **Live/provider facts fail closed.** If Gogo cannot verify a live fact, it says so instead of inventing it.
4. **Consequential writes stop at the approval boundary.**
5. **Retries/idempotency do not duplicate reminders, lists, runs, bookings, messages or charges.**
6. **A failure is visible as a failure.** Infrastructure failure must not fall through to a plain-LLM answer.
7. **Long-running work leaves lineage:** run, steps/activity, status, and final outcome.
8. **Cross-surface continuity:** the same user/run/context is recoverable from WhatsApp and dashboard where a dashboard surface exists.
9. **Secret material never appears in LLM context, Activity, memory, or user-visible summaries unless explicitly required and safe.
10. **No PASS from code inspection alone** for a user-facing E2E row.

---

## A. Routing / control plane

| ID | Test | Expected | Evidence |
|---|---|---|---|
| R-01 | “Find me direct trains from Bangalore to Mysuru on 20 September 2026. Check actual options and timings. Do not book.” | Train specialist; never Weather, Lists or generic chat | CODE — permanent weather/list regressions exist; production retest required |
| R-02 | “Check my mails” | Gmail read; never Lists | CODE — B-G1 patch + regression merged 19 Sep; phone retest required |
| R-03 | “Check what's playing at PVR Forum Mall” | Browser/event research; never Lists | CODE — check-verb regression exists |
| R-04 | “I have training at 6am” | Never Weather from “rain” substring | CODE — weather word-boundary regression exists |
| R-05 | “Remind me to…” | Reminder wins over weather/web/list routes | CODE |
| R-06 | New command while a flight watcher/follow-up is pending | New command is isolated from stale flight context | CODE |
| R-07 | Browser infrastructure throws | Fail closed; no plain-LLM “I cannot browse” fallback | **OPEN** — known morning finding |
| R-08 | Message includes “price/today/latest/news” but is clearly another specialist request | Specialist gets first refusal; web search does not hijack | **OPEN** — broad SEARCH_HINTS still require hardening |
| R-09 | “xm5” while flight watch context exists | Must not parse as flight XM 5 unless flight semantics are present | **OPEN** latent bug |

## B. Reminders / lists / tasks

| ID | Test | Expected | Evidence |
|---|---|---|---|
| RL-01 | Create reminder, repeat identical command | One logical reminder only | PROVEN previously; regression exists |
| RL-02 | “What reminders do I have tomorrow?” | Read only; creates nothing | PROVEN previously; regression exists |
| RL-03 | Compound “create list + remind me” | List persists + isolated reminder; repeat dedupes | PROVEN previously |
| RL-04 | “Show me the list called X” | Exact list target | PROVEN previously |
| RL-05 | Check/tick real short list item | Mutates intended list item | CODE |
| RL-06 | Check query about mail/train/weather/cinema | Declines Lists ownership | CODE |
| RL-07 | Retry after timeout | No duplicate side effect | UNVERIFIED E2E |

## C. Memory / documents / receipts

| ID | Test | Expected | Evidence |
|---|---|---|---|
| M-01 | Upload invoice image | Extract merchant/date/product/amount; saveable asset | PROVEN on phone with Samsonite invoice |
| M-02 | “Save as Samsonite bill” | Rename/classify persisted asset | PROVEN by later retrieval |
| M-03 | “Show me my Samsonite bill” | Retrieve same saved asset + original link | PROVEN on phone |
| M-04 | “What was the total amount on my Samsonite bill?” | Answer from saved asset, not web/guess | UNVERIFIED |
| M-05 | “What did I buy on my Samsonite bill?” | Field-level answer from persisted extraction | UNVERIFIED |
| M-06 | “What is the invoice number?” | Return exact saved field subject to safe redaction policy | UNVERIFIED |
| M-07 | Duplicate save of same source | No unintended duplicate asset | UNVERIFIED |
| M-08 | Sensitive document short link | TTL matches sensitive-document policy | **OPEN** — current TTL previously observed as too long |

## D. Google Workspace — Gmail

| ID | Test | Expected | Evidence |
|---|---|---|---|
| G-01 | “Check my inbox” while disconnected | Signed connect link; no dead end | PROVEN on phone |
| G-02 | OAuth consent → callback | “Google Workspace is ready”; account linked | PROVEN on phone |
| G-03 | “Check my inbox” after connect | Real Gmail results | PROVEN on phone |
| G-04 | “Check my mails” | Same Gmail flow; never Lists | CODE — production retest after B-G1 deploy |
| G-05 | Email with HTML entity | Human-readable apostrophe/entity | CODE — B-G2 fix pending/merging |
| G-06 | Long snippets | Sentence-aware bounded snippet; no ugly mid-token clip | CODE — B-G3 fix pending/merging |
| G-07 | Email contains OTP/login code | Authentication value withheld before downstream use | CODE — security patch pending/merging |
| G-08 | Email contains password-reset/magic-login token URL | Auth URL withheld before downstream use | CODE — security patch pending/merging |
| G-09 | Normal non-auth URL in email | Link remains available | CODE |
| G-10 | “Disconnect Google” / “unlink Gmail” | Revoke token best-effort + clear stored Workspace credentials | CODE — disconnect patch pending/merging |
| G-11 | Gmail disconnect then inbox read | Connect flow returns; no stale-token use | UNVERIFIED |
| G-12 | “What needs my attention?” | Useful thread-aware prioritization, not just latest snippets | **OPEN P1** |
| G-13 | “Draft a reply…” | Draft only; send remains approval-gated | CODE/UNVERIFIED E2E |
| G-14 | “If they don't reply by Friday, remind me” | Email context → watcher/reminder | **OPEN P1** |

## E. Google Contacts / Drive / Calendar

| ID | Test | Expected | Evidence |
|---|---|---|---|
| W-01 | Find a known Google contact | Exact/ambiguous/not-found behavior; never guess address | CODE |
| W-02 | Search a known Drive file | Real matching file(s), scoped to connected account | CODE |
| W-03 | Read supported Drive Doc/Sheet/text file | Verified file content, bounded read | CODE |
| W-04 | Ambiguous contact | Ask/disambiguate instead of guessing | CODE |
| C-01 | Fresh Calendar connect from WhatsApp user | Negative WhatsApp id accepted; OAuth completes | CODE — connect bug fixed, phone retest required |
| C-02 | Read calendar after fresh reconnect | Real events | UNVERIFIED on phone |
| C-03 | Calendar mutation | Structured approval before write | CODE/UNVERIFIED E2E |
| C-04 | Conflict/move flow | Correct event, no accidental duplicate | UNVERIFIED E2E |

## F. Browser / travel / provider execution

| ID | Test | Expected | Evidence |
|---|---|---|---|
| B-01 | Train research request | Enqueue quickly; worker executes with persistent per-user sandbox | PROVEN previously |
| B-02 | Provider clean read | Verified rows only | CODE / provider-dependent |
| B-03 | Datacenter-IP block | **Device handoff** to user's own browser; no fake cloud workaround | PROVEN with IRCTC |
| B-04 | CAPTCHA/login/OTP/payment-auth wall | **Cloud takeover**, same sandbox/session | CODE; takeover runtime previously proven |
| B-05 | User sends CONTINUE without completing takeover | Fail closed, no general-planner fallback | CODE |
| B-06 | Resume after human takeover | Same session resumes and extracts verified result | UNVERIFIED full provider E2E |
| B-07 | Read provider failure | Honest failure; never invented fare/timing | PROVEN fail-closed path |
| B-08 | Long browser reply > WhatsApp chunk budget | Partial send cannot be followed by false “temporarily unavailable” state | **OPEN** |
| B-09 | “Tell me which train you want…” continuation | Downstream intent actually handles train choice, or copy is softened | **OPEN** |

## G. Approvals / execution safety

| ID | Test | Expected | Evidence |
|---|---|---|---|
| A-01 | Read-only action | No unnecessary approval fatigue | CODE |
| A-02 | Send email | Draft/preparation allowed; final send requires approval | CODE |
| A-03 | Calendar mutation | Approval required | CODE |
| A-04 | Booking/payment | Approval required immediately before consequential execution | CODE |
| A-05 | Approval double tap/retry | Exactly-once execution | UNVERIFIED E2E |
| A-06 | Lost execution evidence after irreversible action | Mark needs_attention / pause; never auto-retry | CODE + production DB constraint fixed 19 Sep |
| A-07 | Human auth encountered during approved browser task | Stop before protected step; no password/OTP capture | CODE |

## H. Goals / watchers / Life Events / proactive Gogo

| ID | Test | Expected | Evidence |
|---|---|---|---|
| P-01 | Create background goal | Goal row + bounded plan + watcher | CODE |
| P-02 | Goal hits human-review blocker | status=blocked persists successfully | CODE + production CHECK fixed 19 Sep |
| P-03 | Goal completes | artifact + completion message + watcher stops | CODE |
| P-04 | Flight check-in uncertain | lifecycle_state=needs_attention persists successfully | CODE + production CHECK fixed 19 Sep |
| P-05 | Price/application watcher | Notify only on meaningful condition change | CODE/UNVERIFIED E2E |
| P-06 | Proactive frequency control | User can dial proactive messaging down/up/off | **OPEN — Muse benchmark adaptation** |
| P-07 | Multiple simultaneous tasks | Independent status and no context bleed | UNVERIFIED E2E |

## I. Waitlist / acquisition site

| ID | Test | Expected | Evidence |
|---|---|---|---|
| S-01 | askgogo.in loads without gate | Site-first browsing | CODE — production deployed 19 Sep |
| S-02 | Header/hero/menu/footer Join Gogo | Opens waitlist sheet, never direct bot bypass | CODE — production deployed 19 Sep |
| S-03 | 375px | Bottom sheet usable, no overflow, inputs >=16px | UNVERIFIED manual |
| S-04 | Desktop >=768px | Centered modal usable | UNVERIFIED manual |
| S-05 | Valid India/UAE submissions | 200 + E.164 stored | PROVEN backend |
| S-06 | Invalid phone/email | Inline validation / 400 | PROVEN backend |
| S-07 | Honeypot | 200, no DB row | PROVEN backend |
| S-08 | Duplicate | Same success, update in place, no membership leak | PROVEN backend |
| S-09 | WhatsApp opt-in unchecked | No WhatsApp consent inferred | PROVEN backend contract |
| S-10 | Public pricing | Removed from page source/menu | CODE — deployed 19 Sep |
| S-11 | Legacy pricing/start pages | 301 to / | CODE — deployed 19 Sep |
| S-12 | app.askgogo.in root CTA | Routes to askgogo.in Join Gogo journey, not wa.me | CODE — deployed 19 Sep |

## J. Dashboard / cross-surface

| ID | Test | Expected | Evidence |
|---|---|---|---|
| D-01 | Activity | agent_runs + agent_steps/activity rendered with lineage | **RUN 5 — not built** |
| D-02 | Paused/approval state | Visible, actionable structured card | **RUN 5 — not built** |
| D-03 | Agent Browser | Current browser state + take over/return control | **RUN 5 — not built** |
| D-04 | Scheduled/background history | Run history visible | **RUN 5 — not built** |
| D-05 | Goals | Goal, plan, progress, blocker visible | **RUN 5 — not built** |
| D-06 | Library | Documents/artifacts with source/retrieval | **RUN 5 — not built** |
| D-07 | Same run from WhatsApp → dashboard | One identity/run, no duplicate mission | UNVERIFIED |
| D-08 | Dashboard action → WhatsApp outcome | Same brain/context | UNVERIFIED |
| D-09 | Live status | Human-readable current action, no chain-of-thought | **RUN 5 — not built** |

## K. Security / launch operations

| ID | Test | Expected | Evidence |
|---|---|---|---|
| SEC-01 | Webhook signature log audit | No legitimate traffic falsely rejected before enforcement | UNVERIFIED |
| SEC-02 | Enable webhook enforcement | Invalid signatures rejected | PENDING operational decision |
| SEC-03 | Agent RLS migration | Owner SELECT policies applied; service role unaffected | PENDING |
| SEC-04 | Workspace OAuth token storage | Tokens encrypted at rest with appropriate key management | **OPEN launch blocker for restricted scopes** |
| SEC-05 | Google scope audit | Every requested scope maps to a live user-facing feature | CODE: Gmail, Contacts and Drive reads all exist; verification strategy pending |
| SEC-06 | Workspace disconnect | User can withdraw access and stored credentials are deleted | CODE pending merge |
| SEC-07 | Public app repo | Security-sensitive app repo is private | PENDING |
| SEC-08 | Clean-clone test | npm test runs without undocumented local env bootstrap | PENDING |

---

## Production phone sequence — execute in this order

Use the real production WhatsApp account. Capture one screenshot/result per case.

### 1. Gmail routing + display

1. **“Check my mails”**
   - Must list real Gmail results.
   - Must not mention Lists.
2. **“Check my inbox”**
   - Compare to actual inbox.
3. Choose an email known to contain contractions/entities.
   - No `&#39;` or raw HTML entities.
4. Choose a long email snippet.
   - Clean bounded ending, no mid-token garbage.

### 2. Document memory

1. **“Show me my Samsonite bill.”**
2. **“What was the total amount on my Samsonite bill?”**
3. **“What did I buy on my Samsonite bill?”**
4. **“What is the invoice number on my Samsonite bill?”**

All four must resolve from the same saved document, not web search.

### 3. Calendar

1. Reconnect Calendar if needed.
2. **“What is on my calendar tomorrow?”**
3. Compare returned events with Google Calendar.
4. Ask for a harmless test mutation.
5. Confirm it pauses for approval before write.

### 4. Train / browser

**“Find me direct trains from Bangalore to Mysuru on 20 September 2026. Check the actual available train options and timings. Do not book anything.”**

Accept only:
- verified provider results; or
- explicit provider limitation + correct device/cloud handoff.

Reject:
- weather;
- list response;
- invented timings;
- plain-LLM claim that it browsed when it did not.

### 5. Google disconnect (after other Workspace tests)

1. **“Disconnect Google.”**
2. Expect explicit removal/revocation result.
3. **“Check my inbox.”**
4. Must return a fresh connect flow, never stale inbox access.

---

## Run 4 exit criteria

Run 4 is complete only when:

- all P0 rows required for launch are **PROVEN** or explicitly deferred with owner/reason;
- every known shallow-router hijack has a permanent regression line;
- Gmail connector security cases G-07/G-08 and disconnect G-10/G-11 are proven;
- D1/D4 database state mismatches remain fixed in production and migration history;
- browser failures do not fall through to unverified model answers;
- the production phone sequence above is captured;
- P6 waitlist manual checks pass at 375px and desktop;
- remaining RUN 5-only dashboard rows are handed to the dashboard build without being mislabeled as Run 4 failures.
