# 06 — Duet, dot and Instinct: what AskGogo has, what it lacks (9 Nov 2026)

Scope: product surfaces and interaction patterns only. Runtime/browser architecture is covered by
`02-instinct-teardown.md` and `03-target-product-model.md`; nothing there is repeated. Every claim is
tagged **Observed** (owner's own screenshots/threads), **Reported** (public article) or **Repo** (read
from this codebase on 9 Nov). Nothing is inferred from marketing.

## 1. The three benchmarks in one line each

- **Claude Duet** (Anthropic, research preview, US waitlist). One ongoing thread + channels, tabs Chat /
  Tasks / Make, morning brief, checks every few hours, approval before send/pay/sign/delete, Make holds
  editable outputs, runs on its own VM. Voice is transcription only. *(Reported: claude.com, DataCamp,
  Zapier, dev.to.)*
- **OpenAI dot** (ChatGPT, GPT-6 Astra, launched 29 Sep). A named agent with its own cloud computer, a
  profile side panel (Call, Slack, computer, devices, recent activity, outputs), scheduled runs tab
  (active/paused/completed), four-level custom rules per action (act / pre-approved / ask / hand off),
  proactive research is read-only, Pause and Reset. *(Reported: DataCamp; Observed: owner's "Your
  dot" thread, 9 Nov.)*
- **Instinct** (Spear Street). No app: WhatsApp/iMessage/calls. Quoted-reply threading, 👍
  acknowledgements, multi-bubble replies, connector-on-demand cards, slot-filling that never re-asks,
  credential boundary in plain words, graceful stop at provider walls, initiative on delegation.
  *(Observed: 19 Sep thread, §O.1–O.10 of the teardown; 8 Nov movie-QR thread.)*

## 2. What AskGogo already has (Repo, 9 Nov)

| Pattern | Where |
|---|---|
| Three tabs Chat / Tasks / Make, phone bottom bar | `components/dashboard/dashboard-nav.tsx` |
| One thread + channels sharing memory | `gogo-chat.tsx` ("Duet parity step 4"), `chat-channels.tsx` |
| Approval card v2 (action, rows, what happens, expiry; yes / Later / Change / Don't) | `components/dashboard/approval-card.tsx`, decision route `app/api/agent/approvals/[id]` |
| Tasks: Need you / Radar / Recent / To-dos | `app/dashboard/(app)/tasks/page.tsx` |
| Make with registered kinds (briefs, decks, pages…) | `lib/dashboard/make.ts` |
| Spaces: living pages that refresh (My Day, Trip Board, Tipplr team) | `lib/spaces/*`, `/dashboard/spaces` |
| Connect-from-chat card | `gogo-chat.tsx connectCard` |
| Permission levels per capability (auto / ask / draft / read / off) | `lib/agent/policy.ts`, `agent_permissions` |
| WhatsApp as the main surface, voice notes, Listen button | webhook, `voice-reply.ts`, `listen-button.tsx` |
| Quoted-reply **inbound** (reminder completion only) | `webhooks/whatsapp/route.ts` `OriginalRepliedMessageSid` |

## 3. Gaps, ranked by what the owner would notice first

| # | Gap | Benchmark | Evidence | Cost |
|---|---|---|---|---|
| G1 | Approval cards are on the Tasks page and in a rail, not **inside the chat** where the request was made | Duet (Observed: "$640 · County health permit · Expires in 8 min · Approve / Not now") | Repo: chat renders `RailRow` links to `/dashboard/agent?section=approvals` | Low: card component and decision route exist |
| G2 | **Morning brief** is a WhatsApp text/email; not a chat message with **topic chips** that open the topic's channel; not saved to Make (`daily_brief` kind has no writer) | Duet (Observed: brief with chips Hiring / Northfield / Chicago location) | Repo: `make.ts` comment "No writer saves daily_brief yet" | Medium |
| G3 | **Work cards in chat**: Make outputs do not appear as cards (title · Updated · pin · open) in the thread | Duet (Observed: "Series A deck · Updated 5:48 AM") | Repo: only `OpenUIComparisonInline` | Low–medium |
| G4 | **Spaces from a sentence** ("build me one page I can check every morning") and Spaces **pinned in Make** | Duet (Observed: Marlo Pulse card) | Repo: Spaces created only via template buttons | Medium |
| G5 | **Scheduled runs** view: active / paused / completed, with pause | dot (Reported) | Repo: watchers exist (Radar) but no paused state or per-run pause | Medium |
| G6 | **Quoted-reply outbound** on WhatsApp (reply quotes the user's message) and 👍 acknowledgement | Instinct (Observed §O.2, §O.1) | Repo: not sent; Twilio support to be checked | Low if Twilio supports it |
| G7 | **Profile/side panel** (one place: devices, scheduled, recent activity, outputs) instead of 14 sidebar tabs | dot (Observed) | Repo: 14 More tabs | Medium (this is the sidebar cut) |
| G8 | Onboarding "already knows your setup" list of connectors | Duet (Reported) | Repo: connections page only | Low |
| G9 | Outbound calls (Concierge) | Instinct (Reported) | Repo: Bolna/Plivo planned, not live | High; separate track |

Not gaps (AskGogo is ahead or equal): authorization outside the model, approval TTL, fail-closed
verification, India-first providers, WhatsApp-first, merchant mode, per-capability permissions
(matches dot's four-level rules in effect), Make kinds, channels.

## 4. What this run builds (owner approved the direction 9 Nov, 12:37)

1. **G1** approval cards inline in Chat, reusing `ApprovalCard` and the existing decision route.
2. **G3** work cards inline in Chat for Make artifacts produced by a reply.
3. **G2** morning brief as a dashboard chat message with topic chips → channels, saved as `daily_brief`.
4. **G4** Spaces pinned in Make; "build me a page…" creates a Space from chat behind the same flag.
5. **G7** sidebar cut to Chat / Tasks / Make + avatar menu (mock approved separately).

Shipped 9 Nov: G1, G3 (#1387), G2 (#1387, #1389), G4 (#1387), G7 behind `GOGO_NAV_V2` (#1388, off until the
owner approves the v2 mock).

Findings on the rest:
- **G5 scheduled runs with pause**: `agent_watchers` has only `active`; a real pause needs a `paused_at` column
  (migration, owner-run) plus a resume path. Prepared next; not started without the migration.
- **G6 quoted-reply outbound**: Twilio's WhatsApp API has no outbound reply-context parameter (its blog shows
  `OriginalRepliedMessageSid` only on inbound quick-reply taps). Outbound quoting needs the Meta Cloud API directly,
  which is the Tipplr Meta track. Not possible on the current transport.
- **G8, G9**: unchanged; next block.

## Sources

- claude.com/resources/articles/claude-duet (Anthropic, Duet)
- datacamp.com/blog/claude-duet; datacamp.com/blog/openai-dots
- zapier.com/blog/claude-duet; dev.to/studio1hq/claude-duet-features-pricing-early-reviews-and-limitations-4i53
- top5apps.ai/.../instinct; shikshita.substack.com/p/i-tested-instinct-the-ai-assistant
- Owner screenshots 8–9 Nov (dot thread, Duet demo frames, Instinct movie-QR thread)
