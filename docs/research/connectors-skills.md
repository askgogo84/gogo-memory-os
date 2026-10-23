# AskGogo connectors and skills layer: research and proposal

**Date:** 23 October 2026
**Branch:** `research/connectors-skills` (proposal only: nothing is wired in, nothing deployed, no provider accounts created, no paid calls made)
**Scope:** how to give AskGogo (WhatsApp first, web dashboard, SecondBrain enterprise pilot) thousands of app connectors and a skills layer, for individuals and workspaces.

Prices and claims below are quoted from the cited pages as fetched on 23 Oct 2026. Several are from third-party trackers or competitors' blogs and are marked as such. Anything not confirmed on a primary source is marked **unverified**. Re-check every price on the vendor's live page before signing anything.

---

## 1. Recommendation in one page

| | Choice | Why |
|---|---|---|
| **Primary aggregator** | **Composio** | 1,600+ apps with hosted MCP and per-user scoped credentials; lowest list price at our volumes (about $0.30 per 1,000 tool calls past a 100K/month free allowance, unlimited free connected accounts on our own OAuth apps); SOC 2 Type II, AES-256-GCM token encryption, tokens redacted in API responses, DPA included on Pro. |
| **Fallback** | **Nango** | Different risk profile: predictable per-connection pricing, SOC 2 Type 2, and the only option here with a self-host / BYOC path in any AWS, GCP or Azure region (Enterprise). If Composio's pricing or terms move again, Nango is the exit. |
| **Keep native** | **Google (Gmail, Calendar, Drive, Contacts)** | Already built, encrypted and approval-gated. Composio's managed Gmail app asks for full-mailbox `https://mail.google.com/` access and shows "Composio" on Google's consent screen; AskGogo's own narrower, verified app is the better product and the better privacy story. |
| **Direct MCP** | Providers with official MCP servers (Swiggy today, Razorpay, Zepto later) | Same pattern as `lib/commerce/mcp.ts`; no aggregator margin, provider-branded consent. |

**Three facts behind Composio:**
1. **Breadth with MCP and per-user auth built in.** Composio's docs claim "1,600+ apps your agent can act on", with credentials "scoped to each user and refreshed automatically", exposed through "a hosted MCP endpoint" ([docs.composio.dev/docs/welcome](https://docs.composio.dev/docs/welcome)). These are actions, not only triggers.
2. **Cheapest at 1k–100k users on list price.** Free: 100K tool calls, 50K trigger events per month. Pro: $29/month including a $29 usage credit, then $0.0003 per tool call; connected accounts on your own OAuth app are unlimited and free ([usagepricing.com/blueprint/composio](https://usagepricing.com/blueprint/composio), citing composio.dev/pricing, as of 15 Oct 2026; consistent with [composio.dev/pricing.md](https://composio.dev/pricing.md)).
3. **White-label path and security posture.** Using our own OAuth apps makes the consent screen say AskGogo, and existing managed connections "can be imported into the new auth config" ([managed vs custom auth](https://docs.composio.dev/docs/custom-app-vs-managed-app.md)). "Composio is SOC 2 Type II compliant"; credentials "encrypted at rest using AES-256-GCM" ([security overview](https://docs.composio.dev/docs/security/overview)). Zero data retention is a per-call add-on.

**Main risk:** Composio repriced four times in 2026. The July announcement ($599 tier, $4 per 1,000 overage) was reversed before it shipped ([usagepricing change log](https://usagepricing.com/blueprint/composio); [Scalekit write-up](https://www.scalekit.com/blog/composio-pricing-change), a competitor). Mitigations: the `ConnectorAdapter` seam (section 5), a hard monthly spend cap, and Nango ready as the fallback.

**Estimated aggregator cost** (section 3.3 has the assumptions): about **$30/month at 1,000 users** and about **$450–600/month at 10,000 users** on Composio list price. Add Google CASA (about $540–1,800 a year for Tier 2 at 2024 lab prices, or $4,500–8,000+ for Tier 3), plus LLM tokens, which will cost far more than the connector fees.

---

## 2. How Claude Duet, Wajo and Meta Muse offer "thousands of connectors"

### Claude Duet (Anthropic)
- A proactive agent on Opus 5.5, in research preview for US Pro and Max subscribers ([AI Weekly, 21 Oct 2026](https://aiweekly.co/alerts/anthropic-opens-claude-duet-an-opus-55-agent-to-us-pro-and-max)).
- The product page says it "works with more than 6,000 connectors and plugins" (quoted by AI Weekly). El Ecosistema Startup also reports "more than 6,000 connectors and plugins" ([21 Oct 2026](https://ecosistemastartup.com/claude-duet-el-agente-de-anthropic-que-vigila-tu-correo/)).
- **Mechanism:** Duet uses the apps already linked in the user's Claude account ([Claude help centre, Duet getting started](https://support.claude.com/de/articles/17631495-erste-schritte-mit-claude-duet)). In Claude, "Each [connector] is a connection to an MCP server, which the service runs", and plugins bundle connectors with skills ([claude.com/docs/extend/overview](https://claude.com/docs/extend/overview)). So the count is Anthropic's **directory of vendor-run remote MCP servers plus plugins**, not an aggregator. Anthropic's marketplace listed "over 2,000 extensions" on 28 Sep 2026 ([IT-Connect](https://www.it-connect.fr/claude-marketplace-connecteurs-plugins-agents/)). How 2,000 became "6,000 connectors and plugins" is **unverified**; it may count plugins and skills too.
- **Approval:** "Claude Duet is designed to show you what it will do and wait for your approval before it sends a message" (help centre). Anthropic says the system never sees passwords or tokens directly, and that purchases go through Stripe Link or Shop Pay (El Ecosistema Startup).
- **Lesson for AskGogo:** the scale comes from an open MCP directory that vendors build into, plus skills. AskGogo cannot run a directory that vendors will build for at launch, so an aggregator stands in for one, and AskGogo can accept direct MCP servers where they exist.

### Meta Muse
- Meta publishes no count. A third-party tracker lists **60 live connectors, 18 announced, 30+ community** as of 13 Oct 2026 ([PostFast list](https://postfa.st/blog/meta-muse-connectors-list); PostFast has its own connector in Meta's review queue, so it is not neutral).
- **Mechanisms:** (a) first-party Meta apps connected through Accounts Centre; (b) vendor-built connectors reviewed through Meta's Muse Connector Platform, whose submission asks for "API or MCP documentation"; (c) **Zapier MCP** as the long tail, with "more than 9,000 apps and 40,000 actions through Zapier MCP"; (d) per-user **Custom Connectors** that Muse writes itself ("you can often just ask muse to connect to anything", Alexandr Wang, quoted there). Meta's guidelines forbid hiding "a send, share, publish, or payment action in a tool described as a read or routine edit", the same rule as our fail-closed risk classification.
- **Lesson:** a curated set of first-class connectors, plus one aggregator for breadth.

### Wajo
- Wajo, Inc. (San Francisco) "Integrates with existing tools such as Gmail, Google Calendar, Google Drive, and Slack" ([Stork.ai profile](https://www.stork.ai/en/wajo)). **No public information** on a connector count, an aggregator or MCP was found. Any "thousands of connectors" claim for Wajo is **unverified**.

### Related signal
- AskGogo's own Memorae teardown (5 Aug, the owner's observation during the paid trial) noted Memorae connects Calendar and Gmail **via Composio**. **Unverified** against a public source.

---

## 3. Aggregator comparison

### 3.1 Capability matrix

| | Apps (actions?) | Managed OAuth / white-label | Per-end-user (multi-tenant) | MCP | Compliance | Self-host | Source |
|---|---|---|---|---|---|---|---|
| **Composio** | 1,600+ apps (docs); vendor comparison page says 810–900+ toolkits, 11,000+ actions. Actions and triggers | Managed apps (consent says "Composio") or your own OAuth app per toolkit; Connect Link page brandable; advanced white-label $0.30/connection one-time | Yes: user-scoped sessions and connected accounts | Native hosted MCP | SOC 2 Type II; AES-256-GCM; ZDR add-on; DPA on Pro; BAA add-on | Not on the public pricing page; their comparison page claims VPC and on-prem (**unverified**) | [docs](https://docs.composio.dev/docs/welcome), [security](https://docs.composio.dev/docs/security/overview), [white-label](https://docs.composio.dev/docs/white-labeling-authentication), [vs Pipedream](https://composio.dev/composio-vs-pipedream) |
| **Pipedream Connect** (Workday) | 3,000+ APIs, 10,000+ tools and triggers | Hosted OAuth clients or bring your own; white-label not stated | Yes ("external users") | One MCP endpoint, per-user auth | SOC 2 Type 2, HIPAA BAA, GDPR DPA; AWS us-east-1; logs deleted within 30 days | Not stated | [connect](https://pipedream.com/connect), [security](https://pipedream.com/docs/privacy-and-security/), [pricing docs](https://pipedream.com/docs/pricing.md) |
| **Zapier MCP / Embed** | 9,000+ apps, 30,000+ actions | "Fully managed Zapier OAuth" | Embed/Workflow API for your users; contact sales | Zapier MCP | Not reviewed | No | [zapier.com/developer](https://zapier.com/developer/) |
| **Nango** | Auth for 1,000+ APIs; 10,000+ tools, triggers and syncs | Managed or own OAuth apps | Yes (connections) | MCP server (not in free self-host) | SOC 2 Type 2; HIPAA with BAA | Free self-host is auth and proxy only; full self-host and BYOC on Enterprise | [pricing](https://www.nango.dev/pricing), [self-hosting](https://nango.dev/docs/guides/platform/self-hosting.md) |
| **Merge Agent Handler** | "thousands of pre-built tools" (HRIS, ATS, CRM, accounting, ticketing focus) | Not stated | Unlimited registered users | MCP connectors | SOC 2, ISO 27001, HIPAA badges | On-prem on Enterprise | [pricing](https://www.merge.dev/pricing/agent-handler) |
| **Paragon ActionKit** | "hundreds of synchronous integration CRUD actions"; Truto cites 1,000+ tools ([Truto](https://truto.one/blog/what-are-alternatives-to-composio-for-ai-agent-integrations-2026.md)) | White-labelled Connect Portal | Priced by tenant (customer orgs) | "One API & MCP server" | SOC 2 Type II | Self-host / forward-deploy on Enterprise | [pricing](https://useparagon.com/pricing) |
| **Arcade.dev** | Catalogue; count not published | Default apps are for getting started; production needs your own OAuth apps plus a custom user verifier | Yes, with a per-user verifier (anti-phishing) | Yes (MCP runtime) | AICPA logo shown; SOC 2 **unverified** | VPC or air-gapped on Enterprise | [pricing](https://www.arcade.dev/pricing/), [Google provider](https://docs.arcade.dev/en/references/auth-providers/google.md), [production auth](https://docs.arcade.dev/en/guides/user-facing-agents/secure-auth-production.md) |
| **Scalekit Agent Auth** (other) | Count not stated | Yes | Yes | Yes | Not reviewed | No | [pricing](https://www.scalekit.com/pricing-v6) |
| **Nylas** (Gmail/Outlook only) | Email, calendar, contacts | Shared pre-verified Google app or your own | Yes | Not reviewed | Not reviewed | No | [verification guide](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide.md) |

### 3.2 List pricing as published

| Vendor | Published price | Source / caveat |
|---|---|---|
| Composio | Free: 100K tool calls, 50K triggers, 1M sandbox tokens per month, 3 seats. Pro: $29/month, includes $29 credit; $0.0003 per tool call; $0.003 per trigger; managed-app calls $0.0005 past 20K; managed-app connected accounts first 1K free then $0.10 one-time; ZDR +$0.0001 per call | usagepricing.com (15 Oct 2026) and composio.dev/pricing.md. Grandfathering to 31 Dec 2026 |
| Pipedream Connect | Startup $99/month annual or $150 monthly: 100 external users, 10,000 credits; $2 per extra user; $0.012 per extra credit. One credit per action or MCP call (30s compute) | [usagepricing.com/blueprint/pipedream](https://www.usagepricing.com/blueprint/pipedream) (third party; flags its own contradictions); credit rules from Pipedream docs |
| Zapier | Embed: "Free to build", usage via sales. Retail MCP: 2 tasks per tool call; Professional $19.99/month yearly for 750 tasks | [zapier.com/developer](https://zapier.com/developer/); [Latenode](https://latenode.com/blog/zapier-mcp-pricing) (competitor) |
| Nango | Free: 10 connections. Pay-as-you-go $50/month credit; $0.29 per connection per month; $0.72 per compute hour; $0.50/GB. Enterprise "as low as $0.01/connection/month at scale" | [nango.dev/pricing](https://www.nango.dev/pricing) |
| Merge Agent Handler | Free 2,000 credits; Pro $1,000/month (25K–100K credits); per-call credit cost not stated | [merge.dev](https://www.merge.dev/pricing/agent-handler) |
| Paragon | Custom, by tenant | [useparagon.com](https://useparagon.com/pricing) |
| Arcade | Free 2,000 auth events and 2,000 tool calls; Team $25/month plus $0.10 per auth event and $0.01 per tool call | [arcade.dev/pricing](https://www.arcade.dev/pricing/) |
| Scalekit | 1,000 connected accounts free, then $2 per 1,000; tool-call price not published | [scalekit.com](https://www.scalekit.com/pricing-v6) |
| Nylas | Full platform $15/month incl. 5 accounts, then $1.50 per account per month | [Zeeg](https://zeeg.me/en/blog/post/nylas-api-pricing) (competitor, Dec 2025) |

### 3.3 Modelled monthly cost at 1k, 10k and 100k connected users

**Assumptions (mine; change them and the table moves linearly):** each user links 2 aggregator-served accounts (Google stays native, so it is not counted); 150 aggregator tool calls per user per month (about 5 a day, reads and writes together); no paid trigger events (AskGogo's own crons poll); 0.5 re-auth events per user per month; own OAuth apps on Composio, so connected accounts are free. Steady state, excluding one-time fees and taxes.

| Vendor | 1,000 users (150K calls) | 10,000 users (1.5M calls) | 100,000 users (15M calls) |
|---|---|---|---|
| **Composio Pro** | **≈ $29** (50K past free × $0.0003 = $15, covered by the $29 credit) | **≈ $420–450** (1.4M × $0.0003); ≈ $570 if ZDR is on | ≈ $4,500 list (≈ $6,000 with ZDR); negotiate Enterprise |
| Composio, managed apps for half the calls | ≈ $29–60, plus ≈ $100 one-time for accounts | ≈ $570, plus ≈ $1,900 one-time | ≈ $6,000, plus ≈ $20K one-time |
| **Nango PAYG** | ≈ $600 (2,000 conn × $0.29 + compute) | ≈ $6,100 | ≈ $58K list; ≈ $2–4K at the quoted $0.01/connection Enterprise floor |
| Pipedream Connect Startup | ≈ $3,600 | ≈ $37,800 list (Business plan would be negotiated) | ≈ $378K list: not viable without a contract |
| Arcade Team | ≈ $1,575 | ≈ $15,500 | ≈ $155K list |
| Merge Agent Handler | Free tier likely too small; Pro $1,000 | Pro $1,000+ (credit maths unpublished) | Enterprise |
| Scalekit | ≈ $2 for accounts; tool calls **unpriced** | ≈ $38 plus calls | ≈ $398 plus calls |
| Zapier Embed / Paragon | Sales quote | Sales quote | Sales quote |

**India availability:** every vendor bills in USD by card or invoice and none publishes an India data region (Pipedream states AWS us-east-1). All are usable from India. Expect 18% GST under reverse charge on imported services, and forex mark-up on card payments; confirm with the CA.

**DPDP posture:** the DPDP Rules were notified 13 Nov 2025, with most fiduciary obligations due by **13 May 2027** and consent-manager rules by 13 Nov 2026 ([S&R Associates summary](https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/)). AskGogo (CIQ AI Solutions Pvt Ltd is the data fiduciary per the Google submission doc) stays the fiduciary; the aggregator is a processor. Needed: a signed DPA (Composio includes one on Pro, restored 5 Oct 2026), a processor clause on breach notice that fits our 72-hour duty, logs and retention set to at least one year where Rule 8(3) applies, and ZDR for payload content where possible. Cross-border transfer is allowed unless the destination is restricted by government notification. Have counsel confirm before enterprise contracts.

**Fit for WhatsApp first:** what matters is (a) a short hosted connect link that opens well in the WhatsApp in-app browser, (b) no polling latency on the critical path, and (c) cheap reads. Composio's Connect Link is brandable and its per-call price suits chatty reads. Managed-app polling is "15-minute minimum" ([docs](https://docs.composio.dev/docs/custom-app-vs-managed-app.md)), which is fine for briefings but another reason to use own OAuth apps for anything time-sensitive. Pipedream's and Arcade's per-user and per-call prices penalise a high-frequency chat product. Zapier's per-seat retail model does not fit multi-tenant consumers. It does fit an optional "bring your own Zapier" connector, where the user pays.

### 3.4 Decision

- **Primary: Composio**, on our own OAuth apps for the top toolkits (consent screen says AskGogo), managed apps only for the long tail and for development.
- **Fallback: Nango.** Pipedream would be the breadth-first alternative if a contract brought its per-user price down by about 20x; it is not the fallback at list price.
- **Not chosen:** Merge and Paragon are B2B SaaS-embedding tools priced per tenant or per credit block, aimed at HRIS/CRM. Arcade and Pipedream are 30–100x Composio's price at our call volume. Zapier has no published embed price, but stays a candidate as a user-paid optional connector.

---

## 4. Gmail: going from read-only to broader scopes for many users

### 4.1 Where AskGogo stands (from the repo)
- Read bundle in production code: `openid email gmail.readonly contacts.readonly drive.readonly` (`lib/services/google-gmail.ts:24-30`). Send is a separate one-time upgrade, `gmail.send` (`:32`, `:158`), and every send goes through `stageGmailSendApproval` / `executeApprovedGmailSend` with the approval hash, a single claim and a provider receipt (`lib/agent/gmail-send.ts:148-390`).
- Tokens are AES-256-GCM `enc:v1:` ciphertext (`lib/security/google-token-crypto.ts`; `scripts/verify-google-token-encryption.mts`).
- Calendar `calendar.events` was verified on project `askgogo-493811` on 1 Sep (`docs/AskGogo-Handover-2026-09-01.md:57`).
- A restricted-scope submission package was prepared on 20 Sep (`docs/security/google-oauth-verification-submission-2026-09-20.md`). Whether it was submitted, and its status, is **unknown from the repo: the owner needs to confirm.** Until it is approved, the consent screen shows "Google hasn't verified this app", and unverified sensitive or restricted scopes carry a lifetime cap of **100 new users** (`docs/askgogo-handoff-2026-09-19-for-chatgpt.md:122`). That cap is the real launch blocker, not the aggregator.

### 4.2 Scope classes
- **Restricted:** `gmail.readonly`, `gmail.compose`, `gmail.modify`, `mail.google.com` ([Nylas scope reference](https://developer.nylas.com/docs/cookbook/use-cases/build/google-oauth-scopes.md)), and `drive.readonly` (`docs/security/google-workspace-scope-audit-2026-09-20.md`; confirm in the Cloud Console Data Access page).
- **Sensitive** (verification only, no CASA): `gmail.send`, `calendar.events`, `contacts.readonly`.

### 4.3 What "broader" should mean
AskGogo already has read and approval-gated send. The next useful writes are labels and archive (`gmail.modify`) and server-side drafts (`gmail.compose`). Both are **restricted**. They add review scope and "may require reassessment" if they were not in the earlier assessment ([Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification?hl=ja)). **Recommendation:** submit `gmail.readonly + gmail.send + contacts.readonly + drive.readonly` together now. Keep drafts in AskGogo's own UI, which needs no `gmail.compose`. Add `gmail.modify` only when label or archive is a shipped, demoable feature, ideally inside the same annual CASA cycle.

### 4.4 Process, timeline and cost
1. **Brand verification:** "usually 2 to 3 business days"; results valid for 7 days, so publish promptly (Google page above).
2. **Restricted-scope review:** "can take several weeks" (Google). The internal doc estimates about 6 weeks. Needs the privacy policy on the app's domain with Limited Use language, a demo video, and per-scope justifications (already drafted).
3. **CASA security assessment:** last step; Google Trust & Safety tells you when to start. Assurance level AL1 or AL2 is assigned by Google from user count, scopes and other signals; revalidation is annual ([Google CASA help](https://support.google.com/cloud/answer/13465431?authuser=0)). Developers pay the assessor. Indicative 2024 prices ([Switch Labs](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option), a vendor; **may be outdated**): Tier 2 lab-validated scan **$540 (TAC Security) to $1,500+**, 1–3 weeks; Tier 3 lab pen test **$4,500–8,000+**, 2–6 weeks.
4. **Realistic end to end: 2–4 months** from submission to an approved restricted-scope app. Budget about **$1,000–2,000/year** if assigned Tier 2, or **$5,000–9,000/year** if Tier 3, plus remediation time.

### 4.5 How aggregators handle Gmail
- **Composio managed:** "Your users consent to *Composio's* OAuth app, not yours"; verification "applies to the owner of the OAuth app, and here that's Composio". The managed connection received `https://mail.google.com/` (full mailbox); scopes are fixed; quota is shared; email content passes through Composio ([Composio blog, 30 Sep 2026](https://composio.dev/blog/ship-gmail-integration-in-minutes)). Moving to your own app later makes verification and CASA "your responsibility again".
- **Nylas shared app:** "a Nylas-owned, pre-verified Google Cloud project"; the consent screen shows Nylas; switching later forces re-authentication (Nylas guide).
- **Arcade:** "For production use, we strongly recommend creating your own Google OAuth provider" (Arcade docs). **Pipedream:** hosted clients or your own (docs); how its Gmail verification is handled is **unverified**.
- **Conclusion:** an aggregator can skip *our* CASA only by having users grant a third party full-mailbox access under another company's name. That contradicts AskGogo's read-only, approval-gated positioning and would be hard to explain to enterprise buyers. **Keep Gmail, Calendar, Drive and Contacts on AskGogo's own verified Google app** behind a `native_google` adapter. Use the aggregator for everything else.

---

## 5. Design: provider-neutral ConnectorAdapter

**Code:** `lib/connectors/adapter.ts` (types and pure policy functions, not imported anywhere). **Proof:** `scripts/verify-connector-adapter-policy.mts` (passes; mutation-tested: deleting the approval branch or the secret-key filter makes it fail).

### 5.1 What exists today and how the new layer reuses it

| Concern | Today | Connector layer |
|---|---|---|
| Token storage | Google: `users.gmail_*` as `enc:v1` AES-256-GCM (`GOOGLE_TOKEN_ENCRYPTION_KEY`). Commerce OAuth and vault: `vault_credentials.secret_ciphertext` (`VAULT_MASTER_KEY_V1`), keyed `telegram_id + provider + account_label` (`lib/commerce/connection-store.ts`, `lib/vault/credential-store.ts`) with a `vault_audit` trail | Aggregator connected-account ids and any own-held tokens go into `vault_credentials` under `provider = 'connector:<backend>:<toolkit>'`; the model and the planner see only `ConnectionRef.connectionId` |
| Owner scoping | Every query filters `telegram_id` (service-role Supabase, no RLS isolation); WhatsApp users have negative ids | `ConnectorScope` = personal `ownerId` or `workspaceId`; `scopeProblem()` refuses cross-scope use |
| OAuth state | Signed or hashed single-use state with a 10-minute TTL (`google-login.ts`, `google-gmail.ts`, `commerce/oauth.ts` with PKCE and timing-safe compare) | `beginConnect()` returns AskGogo's callback; the aggregator flow is bound to the AskGogo user id with the same single-use state discipline |
| Approval | `agent_approvals` with `action_hash` from `approval-fingerprint.ts`, `assertApprovalBinding` before execution, TTL guard (`approval-guard.ts`), single claim on `agent_runs`, receipts in `agent_activity` | `stageConnectorApproval()` and `executeConnectorAction()` reuse `buildApprovalBinding` / `assertApprovalBinding` directly. Unclassified actions count as writes |
| Read allowlist | `READ_TOOLS` in `lib/commerce/mcp.ts`; only one named write | `ConnectorActionSpec.risk` must be an explicit, reviewed `'read'` to skip approval |
| Model exposure | Email redaction (`lib/security/email-redaction.ts`), outbound leak filter | `CredentialHandle` prints `[credential]`; `toModelVisible()` drops secret-named keys and secret-shaped values before anything enters a prompt, receipt or log |

### 5.2 Interface (summary)
```ts
interface ConnectorAdapter {
  backend: 'native_google' | 'composio' | 'nango' | 'direct_mcp'
  listToolkits(): Promise<ToolkitSummary[]>
  listActions(toolkit): Promise<ConnectorActionSpec[]>   // risk: 'read' | 'write' | 'irreversible' (absent = write)
  beginConnect(scope, toolkit): Promise<{ flowId, redirectUrl, expiresAt }>
  completeConnect(flowId, callback): Promise<ConnectionRef>
  disconnect(connection): Promise<void>                 // revoke at provider, then delete ciphertext
  execute(call: ProviderCall): Promise<ProviderResult>  // only called by executeConnectorAction()
}
```
`executeConnectorAction()` order: backend match, then scope policy, then (for non-reads) approval present, approved, fresh, same scope and same hash, then credential resolve, then provider call with an idempotency key, then a receipt (`succeeded | failed | outcome_unknown`). A thrown write is `outcome_unknown`, matching how `gmail-send.ts` treats an unclear provider result.

### 5.3 How the planner uses it
- The planner receives `ModelToolDescriptor[]` (name, description, `needsApproval`, input schema) for toolkits the person has connected. Composio's just-in-time tool search keeps this short; never load 10,000 schemas into context.
- A read executes and returns `ModelToolResult` (redacted). A write creates the usual approval card ("📧 Ready to send, approval required" style) on WhatsApp and the dashboard; on APPROVE, the existing worker calls `executeConnectorAction` with the bound approval.
- Rollout keeps `gmail-send.ts` as is. Google moves behind a `native_google` adapter only after the new path has its own production soak.

---

## 6. Individual vs SecondBrain workspace connections

| | Personal | Workspace (SecondBrain) |
|---|---|---|
| Owner | One person (`ownerId`) | The workspace (`workspaceId`); `createdBy` records the admin who connected it |
| Who may connect | The person | Admin or owner only (new `connect_tool` action at admin rank in `lib/workspaces/rules.ts`) |
| Toolkit allowlist | Any catalogue toolkit | `approvedToolkits` set by an admin; default empty |
| Data classes | All of the person's own | `allowedDataClasses`; `mail`, `calendar`, `messages` and `finance` are excluded by default |
| Personal data into workspace | n/a | **Never by default.** `scopeProblem()` refuses a personal connection in a workspace request (`connector_scope_mismatch`), consistent with `SHAREABLE_SECTION_TOOLS = ['artifact','web_search']` |
| Writes | Owner approves each one | Viewer: never. Member: only if `membersMayWrite`. Approval recorded with `scope_key = workspace:<id>`, so a personal approval cannot authorise a workspace write |
| Credentials | Owner's row | Workspace row; members never see the account; removing a member does not disconnect, but removing the connecting admin prompts re-ownership |
| Billing and caps | Per-user meter counter | Per-workspace cap; usage attributed to the workspace |

Existing workspace code already enforces membership on every read (`requireWorkspaceRole`) and keeps workspace files away from personal stores; `verify-secondbrain-pilot.mts` asserts it. Connector rows must join that check, and the pilot's `pilot_read_only` flag should block workspace writes entirely until the pilot ends.

---

## 7. AskGogo Skills, with Ambition first

**Files:** `skills/ambition/SKILL.md` (upstream body unmodified, attribution block after the frontmatter), `skills/ambition/LICENSE` (MIT, Copyright (c) 2026 Monty Singer, as the licence requires), and `lib/skills/registry.ts` (proposal, not imported).

**What a skill is:** a SKILL.md of written instructions, the same format Claude and Codex use, injected into the planner for matching requests. **A skill never grants access**: connectors and approvals do that. Ambition changes how a request is framed and checked.

**Enabling:**
- *Individual:* a toggle on the dashboard (Settings, then Skills) or on WhatsApp (`turn on ambition`). Off by default (`defaultEnabled: false`).
- *Enterprise admin:* `WorkspaceSkillPolicy.allowedSkills` (members may switch these on for workspace work) and `requiredSkills` (always on, e.g. Ambition for every workspace brief). `activeSkills()` keeps personal and workspace skill sets separate.

**How Ambition shapes Make and planner requests:** with the skill active, the planner first produces an `AssignmentBrief` of **outcome and constraints, inputs and method, deliverable, check**. It preserves explicit constraints verbatim, labels scope changes as optional, and asks at most one consequential question. `briefProblems()` rejects a brief that drops a stated constraint or lacks an outcome, deliverable or check. Make artifacts then store the brief beside the result, so the person can see what "done" meant. Modes map directly: `$ambition` is refine (return the improved prompt), "and do it" is execute (subject to normal approvals), and "our approach" is course-correct. Host notes add WhatsApp brevity, "the improved brief is never approval", and no recurring jobs without consent.

**Evals as acceptance tests:** `AMBITION_ACCEPTANCE` turns the 7 upstream scenarios into cases with `expectMode`, `mustPreserve` and `mustNot` (`execute_work`, `ask_question`, `schedule_job`, `invent_numbers`, ...). Scenario 3 also carries its deterministic CSV recount (North 4/2/2, South 3/2/1, totals 7/4/3). One AskGogo case is added: "and do it: email Nithin…" must end in `waiting_approval` with no provider send. The harness would run each case in a fresh planner context with synthetic fixtures and no external write access, as upstream instructs, and grade with code checks plus a human spot-check. Upstream is explicit that a few passes are smoke tests, not proof of reliability; model-graded "looks good" does not count as a pass.

---

## 8. Phased rollout

### 8.1 First 10 connectors (Indian individuals and SMB)

| # | Connector | Backend | Why | Writes (approval-gated) |
|---|---|---|---|---|
| 1 | Gmail | native_google (existing) | Top request; briefings, tickets, bills | Send (live) |
| 2 | Google Calendar | native_google (existing) | Briefings, meeting prep | Create/move (live) |
| 3 | Google Drive + Docs + Sheets | native read; Sheets append via Composio own-app or `drive.file` | Indian SMBs run on Sheets | Append row, create doc |
| 4 | Microsoft 365 (Outlook mail and calendar) | Composio (own Azure app) | Corporate users; already listed as "soon" in `connection-catalogue.ts` | Send, accept invite |
| 5 | Zoho (Books, CRM, Mail) | Composio (Zoho Books toolkit confirmed: [docs](https://docs.composio.dev/kb/toolkit/zoho_books)) | Dominant Indian SMB suite | Create invoice draft, update lead |
| 6 | Razorpay | Direct MCP ([official server](https://razorpay.com/docs/mcp-server)); Composio toolkit also exists ([page](https://composio.dev/toolkits/razorpay/framework/codex)) | SMB payments, settlements, payment links | Create payment link only |
| 7 | Slack | Composio | Workspace pilot teams | Post message |
| 8 | Notion | Composio | Notes and docs for founders and teams; already "soon" | Create page |
| 9 | Shopify | Composio | Indian D2C merchants: orders, inventory questions | Read-only in phase 1 |
| 10 | Zoom | Composio | Meetings, recordings for meeting prep | Schedule meeting |

Check each Composio toolkit's actions in their catalogue before committing; only Zoho Books and Razorpay were spot-checked here. HubSpot, Todoist, Trello, GitHub, Calendly and Tally (no cloud OAuth API) are next.

### 8.2 Phases

| Phase | Scope | Exit gate |
|---|---|---|
| **0. Decisions** (1 week) | Owner approves the choice and spend cap; confirms the Google verification status; Composio Free account in a dev project; DPA reviewed | Signed-off decision record |
| **1. Seam** (2 weeks) | Wire `ConnectorAdapter` behind `CONNECTORS_ENABLED` (default off); `vault_credentials` rows; connect/disconnect UI on `/dashboard/connections`; reads only; Notion + Slack on managed apps for internal testers | Policy script in `npm test`; disconnect revokes; zero secrets in logs (grep check) |
| **2. Writes** (2 weeks) | Approval cards for connector writes; receipts on the Activity page; Zoho, Razorpay, M365 on **own OAuth apps** | Each write E2E: draft, approval, execute, provider readback; `outcome_unknown` path tested |
| **3. Workspaces** | Admin connect, allowlists, data-class policy; pilot stays read-only until signed off | Updated `verify-secondbrain-pilot.mts` |
| **4. Skills** | Ambition toggle (personal, then workspace); acceptance harness | 8/8 acceptance cases pass on two models; human review of 20 real briefs |
| **5. Scale** | Open the long tail through Composio search (allowlisted categories); Gmail restricted-scope approval lands | Cost per active user below the target; error budget held |

### 8.3 Rollback
- One env flag per layer (`CONNECTORS_ENABLED`, `CONNECTOR_WRITES_ENABLED`, `SKILLS_ENABLED`) plus a per-toolkit kill list in config. Turning a flag off hides tools from the planner and refuses execution; stored connections are kept.
- Backend swap: the `backend` field on each connection plus the adapter seam means Composio-to-Nango is a re-connect campaign for affected users, not a code rewrite. Own OAuth apps make this possible, because client credentials we own can be registered on the new backend.
- Native Google is untouched until a separate, later migration.

### 8.4 Cost guardrails
- Composio **per-meter spend caps** (Pro feature) set at 2x the forecast; alert at 50/80/100%.
- AskGogo-side caps: per-user daily connector-call cap, folded into the existing meter (`lib/metering`); per-workspace monthly cap; tool calls retried at most once.
- Own OAuth apps for the top toolkits (free connected accounts, dedicated quota, no 15-minute polling floor).
- No paid trigger events in phase 1: our crons poll on schedule.
- Composio grandfathering ends 31 Dec 2026, so re-price before scaling, and negotiate Enterprise at about 50K users.
- The LLM cost of tool use (schemas plus results in context) is likely larger than connector fees. Cap tool descriptors per turn (≤ 15) and summarise results before they reach the model.

---

## 9. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Composio repricing or terms change again | Medium / Medium | Adapter seam, own OAuth apps, spend caps, Nango fallback, contract with a price lock at Enterprise |
| Aggregator outage blocks connected features | Medium / Medium | Degrade to "can't reach Notion right now"; never claim success; native Google unaffected |
| Prompt injection from connected-app content triggers a write | Medium / High | Writes always need explicit bound approval; content is data in prompts; tool results redacted and size-capped |
| Personal data reaching a workspace | Low / High | Scope check plus data-class policy plus tests; default deny |
| Google verification delays; 100-user cap | High / High | Submit now with the full planned scope set; do not add restricted scopes ad hoc |
| DPDP processor obligations (logs, breach notice) | Medium / Medium | DPA, ZDR, retention settings; counsel review before May 2027 |
| Managed-app consent showing "Composio" confuses users | High / Low | Own OAuth apps for the top 10; managed only in development |
| Vendored skill drifts from upstream or licence lapses | Low / Low | Body kept byte-identical; LICENSE shipped; version pinned in the registry |

---

## 10. Owner decisions needed

1. **Approve Composio as primary and Nango as fallback**, and a monthly connector spend cap (suggested: $50 through the pilot, $600 at 10K users).
2. **Accounts to create** (none created in this research): Composio (start Free, Pro at $29 when moving past testing), and OAuth developer apps under the AskGogo entity for Microsoft (Azure), Zoho, Slack, Notion, Shopify and Zoom.
3. **Google:** confirm whether the 20 Sep restricted-scope package was submitted and its status; approve adding `gmail.send` to the same submission; budget for CASA ($1–2K/year at Tier 2, up to about $9K at Tier 3).
4. **Legal:** which entity signs vendor DPAs. The Google doc names CIQ AI Solutions Pvt Ltd as data fiduciary, while AskGogo is registered under Nexus AI Ventures FZ-LLC. Counsel to review DPDP processor terms.
5. **Skills:** approve vendoring Ambition (MIT) and whether workspaces may *require* it.
6. **Workspace pilot:** keep connectors read-only for the pilot, or allow admin-approved writes.
