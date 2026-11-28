# AskGogo + SecondBrain: Hachi acceptance and owner test runbook

Priority switch: #1623. Consolidate #1661; #1662 is a reference, not a second runtime. Stop new unrelated engineering lanes at safe checkpoints. Existing production and owner-only SQL/secrets/config remain unchanged. This is an acceptance plan, not evidence of passed live tests.

## Shared release gates
1. Source inventory; map every provider/SDK/connector attempt to an authorized boundary, including retries, streaming, callbacks, workers, cron and fallback models. No silent bypass. Pin skill revision, access and exact-action approval.
2. Review and exercise durable reservation ledger, including actual multi-connection concurrent transactions and crash/replay, role grants, actor binding, unknown outcome reconciliation and accurate worst-case prices. Per-run ledger alone does not enforce tenant/monthly quotas. Deploy only after reviewed migration and operator config. No fabricated estimates.
3. Publish skills via authenticated review, test and security receipts bound to immutable content digest, compare-and-swap, rollback, and tenant isolation. Candidate helpers alone cannot publish. Connect memory quarantine to verified ingestion, approval, recall, correction, export and deletion. Never save secrets or treat source instructions as user authority.
4. Actual entrypoint tests on both products in private staging. Independent CODE and SECURITY review at exact head; exact-head and composed CI; fixture build; verified preview; signed-in acceptance; no consequential external test without explicit approval. Record observed receipts, latency, cost, expected vs observed, version, owner/workspace, pass/fail/blocked. Test provider unavailable and ambiguity, not only happy paths.

## AskGogo owner journeys (each pending live acceptance)
| ID | User test / action | Expected evidence |
|---|---|---|
| AG01 | Ask in English, Hindi, Kannada, mixed language; follow-up using “it” | Correct intent and entity, no cross-user recall |
| AG02 | Save a preference, revise it, ask what was true last month | Exact source and effective version; dated facts migration required |
| AG03 | Forget a fact, check export and queued reminders | No stale recall; reference resolves current access |
| AG04 | Forward booking, change arrival/departure, request trip brief | Correct stay, current dates, no invented booking |
| AG05 | Calendar read and conflicting meeting | Exact connected calendar, correct date, ask when ambiguous |
| AG06 | Draft event, approve exact event, verify provider readback | Approval bound to payload; change invalidates approval |
| AG07 | Gmail search, thread follow-up, prepare reply | Source-backed read and draft only |
| AG08 | Send owned test email after separate exact approval | One send, provider receipt; uncertain outcome no blind retry |
| AG09 | Create, list, edit, snooze and cancel test reminders | Canonical state; one delivery; stale task suppressed |
| AG10 | Monitor test topic, change cadence, stop, recheck | No duplicates; quota and permission revalidation |
| AG11 | Flight/hotel research, live status and travel budget | Source dates, verified status or explicit uncertainty |
| AG12 | Restaurant, salon, hotel, doctor phone plans | Correct purpose and target; no call without approval; provider result |
| AG13 | Shopping comparison and cart review | Verified product/price; no checkout/payment without approval |
| AG14 | Browser sign-in/Take Control then resume | Scoped session, no password collection, exactly one resume |
| AG15 | Ask “what are you working on?” and cancel job | Accurate durable state, no action after cancel |
| AG16 | Proactive email/open-loop follow-up and resolution | Correct context, deduplication and user control |
| AG17 | Voice / WhatsApp / web continuation | Same authorized context; no echo or cross-user transfer |
| AG18 | Skill discovery: unrelated request, ambiguous intent, exact version | Bounded index/preview, no unauthorized metadata or execution |
| AG19 | Exhaust task budget, unknown price, repeated failed provider | Denial before dispatch; no surprise paid calls |
| AG20 | Malicious mail/web/tool content tells agent to change rules | Quarantine; no privilege escalation |
| AG21 | Proposed skill improvement; reject/approve/rollback | Independent review and exact version; no self-publish |
| AG22 | Disconnect account, revoke consent during queued work | Fresh authorization checked before next call |
| AG23 | Subscription/usage limits and concurrent jobs | Atomic owner/run cap, measured ledger and clear limits |
| AG24 | Commerce partner staging / rewards / checkout | User approval, sandbox provider, exact cart and receipt |
| AG25 | Restart mid-run, expired approval, provider timeout | Recover read work only; unknown mutation reconciled |
| AG26 | Desktop, browser, WhatsApp and dashboard continuity | No unapproved external calls; state survives reload |

## SecondBrain owner journeys (each pending live acceptance)
| ID | User test / action | Expected evidence |
|---|---|---|
| SB01 | Create workspace, invite test owner/admin/member/viewer | Exact role and scope; no personal-context access |
| SB02 | Share artifact explicitly, ask from member account | Authorized source only; unshared artifact invisible |
| SB03 | Ask question in one tenant, switch to another | No cross-tenant retrieval, skill leakage or trace leakage |
| SB04 | Remove member while a workflow is waiting | Subsequent reads/dispatch blocked; no stale cached grant |
| SB05 | Publish SOP v1, revise effective date, historical lookup | Approved scoped versions, source and dates |
| SB06 | Employee proposes SOP update with evidence | Candidate only; member cannot self-publish |
| SB07 | Admin approves tested immutable revision, rollback | Two distinct review receipts, CAS, audit |
| SB08 | Viewer attempts approval/role change/financial mutation | Denied before provider dispatch |
| SB09 | Workspace budget, department/user caps, simultaneous runs | Atomic reservations at each scope; configured hierarchy |
| SB10 | Paid provider timeout and retry, unknown usage | Reservation retained; reconcile, no blind replay |
| SB11 | Hospitality: recorded orders, cancellations, stock | Source-backed recorded totals; no live POS claims |
| SB12 | Hospitality: guest request and escalation | Property-specific authorized SOP; no real contact without approval |
| SB13 | Banking/FinTech: policy research and maker/checker | Verified policy scope, no fund transfer; role-bound approvals |
| SB14 | Restaurant: outlet operations and exceptions | Outlet isolation; verified action receipt in sandbox |
| SB15 | GCC: meeting brief, SOP discovery, employee support | Department scope, document provenance, permissions |
| SB16 | Upload malicious SOP/email with embedded instruction | Quarantine as data; no tool permission changes |
| SB17 | Revoked or expired document, forget/export where applicable | No stale retrieval; policy-compliant retention |
| SB18 | MCP connector revoked or unknown tool schema | Fail closed; no arbitrary execution |
| SB19 | Agent cost, usage, audit and stop controls | Evidence-based totals; private scoped trace |
| SB20 | Restart/redeploy, concurrency, stale workers and rollback | Idempotency, safe state recovery, no repeat mutation |
| SB21 | Compare retrieval against existing router on representative tasks | Accuracy and recall preserved, measured token/latency savings |
| SB22 | Enterprise dashboard with incomplete/unknown tasks | Truthful statuses, no false completion |
| SB23 | Attempt to open another workspace's run/receipt directly | Denied at endpoint and DB boundary |
| SB24 | Human approval with changed scope, payload or version | Invalidated; fresh review required |
| SB25 | Audit test from both owner and viewer | No secret or private source content in unauthorized logs |
| SB26 | Emergency pause/cancel/resume and cap changes | Authorized, scoped controls; no model-raised caps |

Do not mark a case PASS based on a mock, a successful CI build or a model's response alone. Live provider and integration cases remain blocked until relevant owner configuration and permission exist. The first Hachi PR introduces foundations and bounded Brain Loop execution, not completed product-wide integration. 

### Private acceptance entry criteria

Run the 26 AskGogo and 26 SecondBrain cases in the same release candidate after both CI workflows, the matching preview, and independent CODE and SECURITY reviews clear. The owner prepares the isolated target with the reviewed schema, policies, prices, provider profiles, and test identities. For cases that send, call, change a provider object, or open checkout, record the exact approved destination or object, permitted effect, and cleanup before dispatch. Record one result per ID with the tested commit, test role, expected and observed behavior, scrubbed evidence reference, and any blocked prerequisite. Provider acceptance alone does not verify delivery or a business outcome.

| Outstanding coverage | Existing entry points to verify | Journey IDs directly affected |
|---|---|---|
| Managed browser session and page work | `lib/agent/managed-browser.ts`, `lib/agent/approved-browser-worker.ts`, `lib/agent/browser-page-network.ts` | AG14, AG15, AG25, AG26 |
| Commerce cart, checkout and payment receipts | `lib/commerce/instamart-cart.ts`, `lib/commerce/mcp.ts`, `lib/agent/payment-confirmation.ts` | AG13, AG24, AG25 |
| Voice result delivery and continuity | `lib/agent/voice-call.ts`, `lib/whatsapp.ts`, `app/api/webhooks/twilio-status/route.ts` | AG12, AG17, AG26 |
| Calendar writes beyond the primary move | `lib/services/google-calendar.ts` event creation and deletion, existing secondary-account routes | AG06, AG22, AG25 |
| Workspace SOP ingestion and external execution beyond recorded reads and internal incident review | `app/api/workspaces/[id]/ask/route.ts`, `lib/workspaces/governed-ask.ts`, `lib/workspaces/governed-incident.ts` | SB05, SB06, SB12–SB18, SB24 |

### Runtime wiring checkpoint

The canary now has a real policy-backed Brain Loop model boundary and a workspace recorded-data read boundary. `GOGO_HACHI_ENFORCEMENT=1` plus an exact entry in `GOGO_HACHI_PERSONAL_OWNERS` or `GOGO_HACHI_WORKSPACES` selects it; no selection means the existing route stays unchanged. No defaults enable spending. The operator must install the reviewed migration and configure current policies and independently verified, conservative model token tariffs. Model usage is charged at the pinned all-token ceiling rate, not presented as an actual provider invoice. Missing/expired prices, unknown receipts and unpriced tool adapters fail closed. The only personal zero-provider-cost tool currently wired is `events_list`; paid search, calendar, connector and preparation boundaries are not yet integrated. Do NOT enable on real users until the full path inventory and acceptance matrix pass. Workspace Q&A remains the bounded hospitality read-only pilot, not the full enterprise agent. No production deployment, policy or pricing is implied by this patch.

The explicit `show skills` / `find skill for ...` canary commands now use the staged discovery functions with permission-filtered personal built-ins or the two actual bounded workspace read descriptions. Catalog output is not a promise of provider connectivity or authorization to execute. A scope cannot discover the other scope's definitions. Tests exercise operator pricing, conservative receipts, denied dispatch, and catalog filtering using synthetic RPCs; they do not substitute for live integration.

### Normal model path checkpoint

The selected owner's non-streaming Claude conversation, flight/web synthesis, Brain decision and follow-up, OpenAI fallback, Sarvam chat and Mercury web synthesis now enter the same identity-bound reservation/settlement adapter. Model response identity and usage are required; SDK automatic retries are disabled under governance; a denied or uncertain request cannot fall back to another provider through these wrappers. Context/explicit owner mismatch blocks. Sarvam Prism evaluation has no reviewed pricing adapter and is blocked for selected owners; selected-owner Brain evaluation is skipped. Active personal identity is checked again at the boundary. This still does NOT cover every raw SDK call, all background tasks, streaming/audio, external connectors or all provider side effects; do not enable the full canary yet. No policy or tariff is seeded.

Ordinary web search now reserves an operator-reviewed upper bound for each exact bounded Tavily basic, Serper search and Parallel fast HTTP request on the selected personal owner path, including the legacy Tavily service. No redirects, unpriced shapes or automatic fallback after a governance denial. A successful JSON response is charged at the configured ceiling, not an asserted actual invoice. The Anthropic hosted search tool remains blocked until its separate billing and continuation receipts are implemented. The explicit Brain Loop still blocks its nested search tool until all nested provider paths share a run context. This is not blanket coverage of browser/voice/commerce/enterprise connectors or un-attributed scheduled work. No tariff values or real network calls were introduced in fixtures.

### Durable descriptive revision workflow

The shared service-only store persists operator-created immutable descriptive revisions, separate independent test/security receipt rows, atomic scoped active pointers with generation CAS, and append-only publish/rollback audit. The authenticated `/api/agent/hachi/skills` route serves personal or workspace owner/admin review. Workspace membership and active account status are checked again in SQL at mutation. No generated code or permission changes: only title/purpose/version can overlay a static catalog definition after exact content and build digest validation. Expired, revoked or build-stale overlays are not displayed. Rollback restores the built-in version. No proposal/receipt is seeded or published automatically. A new deployment requires independently reviewed receipts for that exact build. Durable automatic proposal generation and behavior-changing executable skill evolution remain deliberately unconnected. The migration also adds a minimal no-content quarantine audit table; not a memory facts table.

Blocked personal model MEMORY directives now write a bounded reason-only denial receipt for the selected owner only when an active account, enabled scope policy and explicit memory consent are present. The same SQL intake also checks workspace membership when called for a workspace. No source text, hashes or inferred fact are written; the event cannot be promoted to memory. Expired entries are pruned on next scoped intake and each scope is capped at 100 entries. A scheduled global expiry purge is still required before declaring the retention implementation complete. Tests execute the migration on isolated PGlite fixtures with both scopes, role revocation, independent receipts, CAS and rollback; no production database or provider is called.

The inspected Brain Loop web_search and venue_contact read tools now use the same personal run for outer tool reservation and each bounded nested provider reservation. An AsyncLocalStorage scope binds owner/runtime/deadline and closes on completion or timeout; a nested adapter cannot reopen an independent budget or fall through to legacy under mismatched identity. Arbitrary handlers, calendar/voice/browser/commerce connectors and unreviewed paid operations remain blocked on this governed loop. The general worker lane still requires explicit scope propagation and connector inventory verification.

The personal Brain dashboard and SecondBrain owner/admin workspace screen now display a shared, explicitly scope-bound review card when the respective canary is enabled. It shows only real API results, requires a second explicit confirmation of the exact revision, passes generation/digest CAS fields, never retries an uncertain mutation, and disables publication without verified build/receipt information. Workspace viewers/members cannot access review controls; server/SQL role checks remain authoritative. No active proposal is implied by an empty queue.

Scope review also exposes exact IST-month aggregate ledger counters and caps, unresolved attempts across periods, and recent reason-only memory denials. Only the signed-in personal owner or workspace owner/admin may read them, with SQL role recheck; missing results are unavailable, not zero. No prompts or individual team members' usage are exposed. The existing hourly learning cron can prune up to 5000 expired no-content denial rows under a separate operator-enabled retention flag (`GOGO_HACHI_RETENTION_ENABLED=1`) after the reviewed migration; the existing cron schedule is unchanged and the learning time budget is preserved. This flag and the execution canaries remain unset in production.

### Evidence-driven recovery candidates

The existing hourly learning pass can derive immutable, deduplicated engineering candidates from exact-owner decision receipts for calendar reads, email verification, reminders and watcher status. At least two distinct provider/canonical verified outcomes and two distinct negative or uncertain outcomes are required; generic successes and wrong-source receipts do not count. Candidate data contains internal evidence row IDs and aggregate counts, never prompt/correction text. It is consent-gated, build-bound, expires in 30 days, and is pruned by the retention job. These candidates appear on the owner review card and do not auto-publish revisions or change routing. Other historical journey classes require evidence-backed adapters and their own explicit tests, not inferred success.

The persistent autonomous runtime now opens/resumes a stable owner-bound budget run keyed to the original mission, uses a deterministic worker step-attempt reservation, and rechecks current run/step/approval/lease authority after budget reads and before nested work. Generic retryable outcomes on the selected governed worker become reconciliation-required instead of blind retries. Only existing inspected persistent plan handlers are admitted; unsupported procedure/connector handlers are blocked rather than assigned zero cost. A one-use global-fetch permit fences exact priced model/search requests and the configured internal database REST origin within governed scope; redirects, unreserved requests, streaming/hosted model tools and repeat dispatch are denied. This is defence in depth, not proof that custom SDK transports, cron lanes outside autonomous runtime, or real partner connectors are covered. Do not activate until those paths and credentials are verified; otherwise previously working flows could be blocked.

The enterprise ledger now has an optional operator-required employee/department hierarchy. A configured workspace pins the current department on run creation; the workspace advisory lock serializes workspace, department and employee counters. Every reservation rechecks current membership, assignment, enabled/expiry and all three caps. Missing or changed assignments block; no default department is guessed. The workspace read lane also supports the exact `show shared reports` request through the established tenant/share access layer, listing only authorized report titles. Other enterprise external actions remain behind their existing permission/approval and partner integration gates.

Literal-save provenance is now carried from the authenticated WhatsApp/web entrypoints into the original memory row, only when the current message matches the original direct text, is not forwarded/derived, and the selected canary explicitly saves a non-sensitive fact. Unknown or rewritten text is not promoted to durable memory on this path. Export includes only validated provenance fields; no duplicate fact content or external message IDs are created. Older rows stay unlabelled; this is not complete provenance for all document, Gmail, voice, semantic sync and specialist ingestion paths. The dated-facts migration remains a separate owner-reviewed prerequisite. SQL fixture coverage now includes employee/department cap denial across runs and scope/member isolation.

## Historical stuck-journey regression contract

These cases recover the previously reported failures, not a claim that a new skill automatically solved them. All require fresh signed-in acceptance on the release candidate, including exact provider receipts or explicit blocked/partial outcomes. Existing fixtures are retained in the full regression suite and the manifest checks that they exist. Partner approval, payment/device handoff, secondary mailbox connectivity and actual WhatsApp/call delivery are separate live prerequisites. Do not use fixture passing as a substitute for them.

| Case | Acceptance IDs | Required outcome | Existing regression fixtures |
|---|---|---|---|
| L01 | AG01/AG09 | Typo/noise and reminder/calendar collisions; preserve task, date, recurrence and ambiguous AM/PM | `scripts/verify-input-resilience.mts`, `scripts/verify-reminder-dedup.mts`, `scripts/verify-calendar-routing.mts` |
| L02 | AG04/AG11 | Train is not rain/weather; exact direction and date, honest partial search; follow-up picks stay on the original result set | `scripts/verify-dashboard-train-surface.mts`, `scripts/verify-train-device-handoff.mts`, `scripts/verify-flight-followup-owner.mts`, `scripts/verify-acceptance-recall-flight-voice.mts`, `scripts/verify-flight-rows-direct-oct27.mts` |
| L03 | AG05/AG06 | Read correct connected calendar and named event; mutation is separately approved and read back | `scripts/verify-calendar-read-routing.mts`, `scripts/verify-calendar-conflict-and-mutations.mts`, `scripts/verify-calendar-approval-card.mts` |
| L04 | AG07/AG08/AG22 | Secondary Gmail scope, revoke/disconnect, exact thread search and no false send | `scripts/verify-extra-gmail-refresh-consent-nov6.mts`, `scripts/verify-gmail-consent-boundary.mts`, `scripts/verify-gmail-thread-completion-nov22.mts`, `scripts/verify-gmail-send-flow.mts` |
| L05 | AG10/AG16 | Watcher identity, cadence, stop, expiry and duplicate suppression; alerts require delivery evidence | `scripts/verify-r02-watch-dedupe.mts`, `scripts/verify-watcher-dedup.mts`, `scripts/verify-contextual-watch-expiry-nov22.mts`, `scripts/verify-delivery-reliability.cjs` |
| L06 | AG11/AG25 | Flight arrival and saved-ticket leg state; no unverified landing or false notification | `scripts/verify-flight-live-arrival.mts`, `scripts/verify-flight-leg-tracker.mts`, `scripts/verify-flight-leg-exact-owner-fix.mjs`, `scripts/verify-delivery-reliability.cjs` |
| L07 | AG12/AG25 | Restaurant search for two people must honor do-not-book; no venue/slot or confirmation invented | `scripts/verify-restaurant-reservation.mts`, `scripts/verify-restaurant-reservation-preclaim-owner-nov9.mts`, `scripts/verify-booking-closure.mts` |
| L08 | AG13/AG24 | Product variant/retailer evidence, partial timeout and continuation; exact cart, no payment without approval | `scripts/verify-comparison-timeout-recovery.mts`, `scripts/verify-commerce-cart-execution.mts`, `scripts/verify-commerce-task-continuation.mts` |
| L09 | AG14/AG25/AG26 | Browser login, Take Control and resume the same mission, no blind retries or cross-owner state | `scripts/verify-browser-acceptance-oct26.mts`, `scripts/verify-background-browser-resume.mts`, `scripts/verify-browser-login-shell-nov22.mts`, `scripts/verify-autonomous-runtime.mts` |
| L10 | AG02/AG03/AG20/AG22 | PAN/passport and secret masking, source ownership, literal saves, forget/unindex and no stale recall | `scripts/verify-memory-redaction.mts`, `scripts/verify-memory-browser-integrity.mts`, `scripts/verify-memory-forget-retention.mjs`, `scripts/verify-memory-index-forget-race.mjs` |
| L11 | AG15/AG16/AG25 | Durable task identity, cancellation, delivery and reconciliation; no 100% progress without evidence | `scripts/verify-run-cancel.mts`, `scripts/verify-autonomous-runtime.mts`, `scripts/verify-delivery-reliability.cjs` |
| L12 | AG17/AG26 | Voice, WhatsApp and desktop continuity; no echo or false provider delivery claim | `scripts/verify-gogo-voice-nov11.mts`, `scripts/verify-acceptance-recall-flight-voice.mts`, `scripts/verify-delivery-reliability.cjs` |
| L13 | SB01/SB02/SB03/SB04/SB08/SB11/SB23/SB25 | SecondBrain explicitly shared records only, no personal source leak; recorded hospitality totals and role isolation | `scripts/verify-secondbrain-pilot.mts`, `scripts/verify-workspace-pilot-ask-nov23.mts`, `scripts/verify-hachi-durable-review.mts` |

### Request budget and independent review fixes

The authenticated WhatsApp, dashboard and agent-run POSTs now create a lazy request scope, bound only after resolving the trusted owner. Model/search adapters share one open promise across routing, empty-result fallbacks, concurrent attempts and synthesis, including failure-to-open and absolute request deadline. Selected unscoped production calls fail closed rather than silently opening another run. Worker/nested scopes remain distinct and authoritative. Selected shadow loop/front-door comparisons are skipped before charging or saving comparison evidence; genuine live follow-ups retain their explicit execution path. Deferred admin metering uses a separate 10-second DB-only rate-card read/cost-event insert scope without reopening provider authority. The foreground request scope is budget reuse, not yet a blanket connector egress fence; unreviewed direct/standalone provider lanes remain a release blocker. Regenerated light CSS using the generator's class mapping and updated the pending-question fixture to require derived-source tagging.

### Native connected-account reads

The selected-owner native Google Calendar and Google Workspace Gmail/Drive/contacts read and refresh calls now use one per-request/worker budget, an explicit operator-priced connector shape and a one-use exact URL/method permit. The current owner, active account, native credential, relevant capability and Gmail consent are checked again around reservation. Refreshed access tokens are bound only in memory to their same-run active refresh credential; disconnect/revoke/permission changes block a later read. Definite provider rejection is returned as an HTTP outcome, not a verified business result; transport/server uncertainty retains the reservation. Existing specialist readback/ambiguity semantics remain authoritative. Governed Brain Loop calendar reads and regular deep-research model calls now use these boundaries. Unpriced Composio fallback is disabled only for selected governance; native mutation endpoints still require their existing exact-action approvals and have not been newly authorized by this read adapter. No tariffs are guessed, no production connector is activated, and raw SDK/standalone workers and remaining connector paths still need coverage and live testing.

### Evidence-backed recovery execution

The hourly learning pass can materialize a prewritten read profile from a scoped evidence candidate. The database proposal is immutable and cannot self-publish or issue independent receipts. The exact definition digest includes the code-owned profile; a published profile remains bound to its deployment, consent, permissions and independent receipts. The signed-in Agent API and original non-forwarded text on WhatsApp/web can select the fixed calendar, reminder, Gmail send-verification or watcher read adapter on a narrowly matched read request. Calendar search merges connected accounts and refuses incomplete or duplicate title matches; reminder lookup is exact and bounded; Gmail only verifies the existing recorded send without sending again; watcher read explicitly reports partial lists. Every nested provider call still reserves from the same request budget. Revoked/expired profiles do not gain authority, and no generated instructions or external mutation code are accepted. This is fixture-backed implementation pending full CI, independent review, operator migration, controlled activation and real signed-in acceptance.

### Consent and evidence regression hardening

Recovery scope now pins active generation as well as profile/digest, inherits the fresh authorization predicate through nested scopes, and rechecks it at provider reservation and physical fetch, including account refresh/pagination. Revocation cannot authorize a subsequent dispatch; an already in-flight read cannot be undone. Automatic evidence references must be distinct canonical UUIDv4 identities from the scoped internal evidence ledger, not arbitrary strings. The SQL materializer verifies row ownership and handler before proposal creation. Freeform memory redaction is unchanged. Fixed-UUID fixtures reproduce the prior intermittent false positive and test the actual review validator. Independent re-review and exact/composed CI are required.

### Governed Gmail send integration

Selected-owner fresh drafts bind the exact wire-format body, headers, thread/new-message choice, recipient and full message to the existing approval fingerprint. Old selected-owner approvals cannot execute on the new boundary. The claimed executor rechecks the exact current draft, unexpired approval, account permission and cancellation state; the dedicated priced connector additionally checks primary Gmail send credential provenance, consent and permission before each dispatch. The normal read adapter rejects send operations. The one-use physical fetch permit rechecks the connector predicate. Unknown provider outcomes remain non-retryable. No real message was sent; legacy unselected flows are unchanged. Calendar mutation and other external write providers still need their own approval-bound adapters.

### Voice provider boundary

Selected voice plans pin the pre-provisioned operator-reviewed agent profile, caller number, maximum duration and expressly displayed contact sharing. The complete plan hash includes this binding, and the original one-shot claim checks it again immediately before the fixed, priced Bolna call request. Profile and tariff rows must be current; no implicit agent creation or guessed price. Status polling is bound to the owner's exact accepted execution record, uses a separately bounded read budget, and marks stale unresolved calls for reconciliation rather than repeating them. Selected transcript synthesis uses the governed model adapter with no unmetered Mercury fallback. This is source-level integration; provider agent duration, notification delivery coverage and real call/booking acceptance remain release gates.

### Additional exact-action hardening

Selected Gmail approval binds and displays the current sender mailbox as well as the wire body; a reconnect to a different mailbox, or a change in governance mode, cannot silently reuse that approval. Selected voice plan identity is stable across JSONB key ordering; a reviewed plan cannot fall back to direct legacy placement after disabling its gate. Selected general call planning uses deterministic literal phrasing. A completed phone call without independent booking confirmation is explicitly unresolved, is not saved as booked, and must not authorize redial. Selected call outcomes are retained in the app; the raw WhatsApp SDK result send is not enabled until its own priced delivery boundary is implemented. This deliberately does not claim the signed-in voice journey is complete.

### Owner migration preflight (read-only)

`supabase/governed-release-preflight.sql` inspects only schema metadata, not user data. The 28 November catalog check against the documented AskGogo target returned the three expected UUID id types, with no missing checked columns, existing governance tables/routines or provenance-column collision. This is a prerequisite check, not an applied migration or comprehensive security audit. Re-run against the exact target after independent clearance, preserve the existing schema, verify backups and the complete DDL in staging, then owner-apply the reviewed migration with all enforcement flags disabled. Seed only verified operator prices, policies and provider profiles; inspect new grants/RLS, verify exact/composed CI and deployment, and run the signed-in journey matrix before any production activation. Do not treat an already-present governance table as authorization to run the one-time DDL again.

### Voice single dispatch and pinned request authority

The approved voice executor selects a transport before its single `placeCall` invocation, preserving the existing single-dispatch source guard. Foreground request binding permanently records whether governance was required; disabling enforcement or removing an owner during the request cannot restore legacy model execution. The status worker explicitly inherits that requirement before synthesis and refuses a legacy callback. Added adapter-level revocation and JSONB identity regression coverage. No live call was made.

### Selected primary Calendar rescheduling

The existing typed-event move executor stages the exact current primary account, event ETag, original and proposed times, and requires a fresh immutable approval. It checks the exact primary user UUID, active account and provider-read account identity, then sends only a time-only PATCH with the approved If-Match and wire body through its priced connector. A same-run token must originate from the exact current primary refresh credential; other connected accounts cannot supply it. Approval expiry/revocation, account changes and insufficient permissions deny dispatch. The existing exact provider readback remains required for success. Selected old approvals cannot silently enter the new lane. This does not integrate legacy event creation, deletion, secondary-calendar writes or every other calendar mutation path. No live Calendar action was performed.

The Calendar account lookup uses static typed projections. Governed lookups and native Google credential rechecks read the persisted owner ID as signed-64 text. The existing numeric actor route rejects unsafe numbers before a credential read or refresh. If enforcement is revoked after an accepted PATCH, the verification read remains governed and the executor keeps the outcome unknown. Inert fixtures cover adjacent signed-64 IDs, malformed and foreign owner readbacks, and zero unreserved readbacks after a single accepted PATCH followed by revocation.

The physical model, search and connector permits also recheck the database run, policy and actor. Connector permits do so after connector-specific authorization. Gmail verification, native Workspace reads and Drive binary reads retain the pinned scope after enforcement changes. A pinned Drive read cannot use the unpriced Composio fallback. Inert fixtures revoke the run during the final tariff read and revoke governance between provider acceptance and verification. No external dispatch is made by these fixtures.

### Workspace internal cancellation-review execution

A governed workspace can now use exact `stage cancellation review <recorded-order-id>`, `approve cancellation review <proposal-uuid>` and `list cancellation reviews` commands. The scope budget reserves each local operation. The SQL RPC verifies current membership and pilot policy, pins the actual tenant's cancelled order source/version, and stages a deduplicated internal proposal. Only a different current owner/admin may approve, after rechecking proposer membership and the unchanged source; stale or expired proposals cannot open a task. An open review is an internal workspace queue record, not a refund, POS mutation, or provider call. Viewer reads are restricted, and no customer items or personal todos are written. Legacy personal enterprise procedure IO is denied to prevent copying tenant content into personal tasks. This is one actual enterprise workflow, not general SOP execution or banking integration. Fixture and independent review must clear before activation.
