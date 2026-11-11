# Same Brain 3.0, Addendum 6: Anchor Browser

Status: 11 Nov 2026. Adapter built and tested against a fake API; not yet run against Anchor (no account or key). Off for everyone.

## 1. What AskGogo already has (read from code)

| Area | Where | What it does today |
|---|---|---|
| Provider switch | `lib/agent/managed-browser.ts` (`GOGO_BROWSER_RUNTIME=browserbase`) | One managed provider, Browserbase. Without the flag, local Chromium in the Vercel sandbox. |
| Persistent login | Browserbase Contexts, one per owner and site, ids stored in the owner's sandbox | Login survives across sessions. Explicit per-owner imports only; no shared default login. |
| One writer per profile | `pending` marker plus "end the old session, wait, then start" | An unknown create outcome blocks new sessions until reconciled. |
| Owner lock | `browser-owner-lock.ts` | One run per owner's browser at a time (20 minutes). |
| Navigation limits | Browserbase `allowedDomains` plus a broker in the sandbox that blocks off-allowlist requests and service workers | Checked from a separate CDP client in the 2 Oct smoke test. |
| Human takeover | `provider-browser-handoff.ts`; Browserbase live view, screenshot relay as fallback | Live view link served only through the signed-in dashboard. |
| Cost bounds | 5-minute normal / 20-minute keep-alive timeouts, release at run end, orphan sweep cron | |
| Vault and sign-in | `secure-computer.ts` vault login, OTP asked in chat | Passwords never reach the model. |
| Public read-only | Obscura pilot (`obscura-public-read.ts`) | Public pages only. |
| Approvals | Existing approval cards and action guards | A browser connection grants no action scope. |

Confirmed missing: no second managed provider; no hosted "connect your account" flow on a provider's side (sign-in happens in our takeover); no verified-agent identity (Web Bot Auth); no deterministic, versioned site actions.

## 2. Anchor against Browserbase

Sources: Anchor's own documentation and pricing page as read on 11 Nov 2026; not independently verified. Nothing here is measured yet.

| Capability | Browserbase (in use) | Anchor (documented) | Note |
|---|---|---|---|
| Session API | `POST /v1/sessions`, returns CDP URL | `POST /v1/sessions`, returns `cdp_url`, `live_view_url` | Same shape; the adapter reuses everything around it. |
| Persistent login | Contexts | Profiles (`browser.profile.name`, `persist: true`) | Equivalent on paper. |
| Hosted account connect | None | Identities and a hosted sign-in link (OmniConnect-style), callback with `identity_id` | Main new capability. Needs the Starter plan. |
| Verified agent identity | None | Cloudflare Web Bot Auth (`web_bot_auth.active`) | Pricing page lists "Cloudflare verified browser agents" under Growth and Enterprise only. |
| India egress | Browserbase proxy, country IN | `anchor_proxy`, `country_code: "in"` | Both. |
| Domain limits | `allowedDomains` | `domain_allowlist` (max 100) | Both; our broker still applies. |
| Recording | Off | On by default; turned off by the adapter | |
| Data retention | Not reviewed here | 7 days on Free and Starter; Zero Data Retention on Enterprise only | Matters for enterprise. |
| Live view | Debugger URL fetched with the API key | `live_view_url` in the create response, identified by session id; `one_time_url` option | The pilot does not use Anchor's live view: takeover falls back to our screenshot relay until its access control is understood. |
| Reusable site actions | None | Action Index and Automation Tasks ($0.10 a run) | Not part of this pilot. |
| Price | Plan-based | $0.05 per browser-hour, $0.01 per browser, $8 per GB through Anchor's proxy; Free ($5 credits), Starter $50/month, Growth $2,000/month | Proxy bandwidth will dominate on heavy pages. |

Two corrections to the brief we were given: Web Bot Auth is listed under Growth ($2,000 a month), not a $500 Team tier; and Free/Starter keep session data for 7 days.

## 3. What was built (PR for `feat/anchor-browser-pilot`)

Inside the existing resolver, not a new browser system:

- `resolveAnchorSession`: same contract as `resolveManagedSession` (endpoint, host, id, newSession, release). One profile per owner and site, with a random name stored on first use beside the Browserbase Context ids; neither touches the other. A lost state file starts a fresh profile (a new sign-in) rather than attaching to a live one.
- Session request: recording off, CAPTCHA solving off, extra stealth off, India proxy, the same top-level domains as Browserbase, 5-minute cap (20 for takeover and commerce), idle 2 minutes, one-time live view, Anchor's data masking off (it may blank fields the executor reads; AskGogo's own redaction applies), Web Bot Auth only with `GOGO_ANCHOR_WEB_BOT_AUTH=1`.
- One writer per profile: an existing session is reused only if it reports live, is for the same site and policy, and has more than a minute left. Otherwise a new session starts only after the old one is confirmed ended; if that cannot be confirmed the run fails (`anchor_previous_session_closing`) and nothing new is started. An unknown create outcome blocks new sessions for 25 minutes (longer than any session can live).
- The connection URL must be `wss://<sub>.anchorbrowser.io` with no port, and must not contain the account API key (it is handed to the sandbox where pages run). If it does, the session is ended and the run fails with `anchor_connection_embeds_api_key`.
- Release by id: ids are marked `anchor:` so teardown calls Anchor's `DELETE /v1/sessions/{id}`, and the Browserbase live-view lookup is never sent an Anchor id. The orphan sweep lists Browserbase only; an Anchor session left behind ends at its own 5- or 20-minute cap.
- Who gets it: only users listed by exact `users.id` in `GOGO_BROWSER_ANCHOR_USERS`, only while `GOGO_BROWSER_RUNTIME=browserbase`, only with `ANCHOR_API_KEY`. Never chosen automatically after a failure. Covers the user's general and commerce browsers; per-store comparison browsers stay on Browserbase in this pilot, so measurements compare like with like only for the general and commerce flows.
- Log line `MANAGED_BROWSER_PROVIDER` records which provider served each run (no URLs, ids or content).

Not built: Anchor identities/hosted connect, Web Bot Auth trials, Action Index, any checkout. Each waits on the measurements below.

## 4. Measurement plan (owner's number only)

Same tasks on both providers, alternating days, through the normal WhatsApp flows:

| Test | Message | Pass |
|---|---|---|
| A. Authenticated account | Sign in to Swiggy through the takeover; next day ask for the saved address | Signed in without a new login; correct account |
| B. Shopping research | "Compare Amul Taaza 1 litre on Instamart and Zepto, delivered to 560086" | Price and availability read from the page, with evidence; no cart change |
| C. Human takeover | A site that asks for an OTP | Resumes the same task after the code |
| D. Travel | "Flights Bengaluru to Goa on 20 December" | Fares read; stops before booking |
| E. Enterprise | Not possible until an authorised test dashboard exists | |

Recorded per run from logs: provider, completed or not (and why), human steps needed, time, and provider cost (Anchor's sessions history API; Browserbase usage). Ten runs per test per provider before any conclusion.

## 5. Security and retention

- Key: server-side only (`ANCHOR_API_KEY` in Vercel), sent only as the `anchor-api-key` header, never stored in state or logs, never in the sandbox.
- Profiles: one per owner and site; never shared across users or tenants; the owner id is a hash in tags and names.
- Recording off. Retention on Free/Starter is 7 days for what Anchor keeps; that is acceptable for the owner-only pilot, not for enterprise without ZDR.
- No CAPTCHA solving, no extra stealth, no automatic provider switch after a refusal.
- No checkout or payment in the pilot. Existing approvals and action guards are unchanged.
- Rollback: remove the user from `GOGO_BROWSER_ANCHOR_USERS`. Browserbase Contexts were never touched, so the Browserbase login still works. Anchor profiles stay at Anchor until deleted from its dashboard.

## 6. Go / No-Go

**No-Go for general use. Go for an owner-only pilot**, because the adapter is small, off by default and keeps Browserbase as it is. Adopt Anchor for more users only if the measurements in section 4 show a higher completion rate or lower cost per verified task than Browserbase on the same tasks. The one capability Browserbase cannot match on paper is hosted account connect (identities); that is the next thing to evaluate if the pilot holds.

## 7. To start the pilot (owner)

1. Create an Anchor account and an API key at app.anchorbrowser.io (Free plan to start).
2. In Vercel, Production: `ANCHOR_API_KEY` = the key; `GOGO_BROWSER_ANCHOR_USERS` = your `users.id`.
3. Redeploy, then run test D and test B on WhatsApp.
