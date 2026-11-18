# AskGogo LinkedIn Engagement — staged implementation (18 Nov 2026)

This PR adds the first native AskGogo chat/WhatsApp drafting workflow and a permission-safe decision layer. **It does not connect an account, ingest the personal feed, post comments, or change production.**

## Conversation examples
- `/linkedin-comment <post text or screenshot description>`
- `Draft a LinkedIn comment about this post: <quoted post text>`
- `Show relevant LinkedIn posts` requires a permitted source and a separate discovery worker (not implemented).
- `Publish this comment` must go through exact-comment review and a provider connector; never treat a chat command as broad approval.

## Connection and provider prerequisites
1. Register an AskGogo LinkedIn developer application using a verified organization and exact HTTPS OAuth callback; provide a privacy policy and user consent UI.
2. Obtain LinkedIn permission for commenting on behalf of a member (`w_member_social`) and verify that the specific endpoint/use case is approved for the app. The `r_member_social` read scope is restricted/closed to new access requests according to current LinkedIn Community Management documentation. Personal-feed discovery must therefore not be promised.
3. Only use OAuth Authorization Code + PKCE where supported, server-side code exchange, strict state/nonce and exact redirect URL. Encrypt refresh/access tokens at rest per owner; store expiry and scopes, never passwords or session cookies. Revoke/Disconnect and allow exported audit trail.
4. Approved link-based post source: user-submitted post URL and pasted content, authorized post API responses, or public pages only when explicitly permitted. No logged-in web scraping, bot browsing, scraping services, bypassing anti-bot measures or auto-likes.
5. Add an owner-bound engagement queue in Supabase with RLS, per-item evidence source/date/URL, draft, status, immutable draft version hash, approval record, provider outcome id, unique (owner, target, draft hash), 15-minute approval expiry and an `outcome_unknown` state requiring reconciliation, not blind retry.
6. Integrate queue through WhatsApp and dashboard: `Find AI posts`, `Draft top 3`, `Review`, `Approve <id>`, `Reject`, `Pause`, `Disconnect LinkedIn`. Any publish request must be tied to one exact post/comment pair and a logged-in owner.
7. Connect existing nightly/daily engagement scan to AskGogo's queue only when source is verifiable. Report no results rather than fabricate authors, dates or LinkedIn URLs. Never auto-publish unattended as a growth bot.
8. Ship with the feature disabled pending provider credentials, granted scopes, tests, and human UAT. Coordinate with #274; keep other agents' branches untouched.

## Guardrails
No sensitive information in comments. No unsupported product claims, artificial engagement, bulk replies, duplicate comments, implicit approval or posting on a user's behalf without per-action approval. Rate-limit and anti-spam rules. Record provider confirmation before calling a comment delivered.

## Testing
`npx tsx scripts/verify-linkedin-engagement-nov18.mts` tests URL validation, relevance, dedupe and approval enforcement. Before production, add simulated LinkedIn OAuth callback state/CSRF, owner isolation, token expiry, declined scopes, 401/429, revocation, uncertain publish outcome, UI approvals, and provider-verified success tests.

API references: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview and https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
