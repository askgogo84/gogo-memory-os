# Context-first brain (Phase 0, 27 Oct 2026)

Why: ~200 keyword rules could answer a message before anything read the conversation ("Did it land?" became
"Marked done: it land?"). Assessment: https://claude.ai/artifact/KPAkWcsSCZDFCue3BXG4TT

What runs (lib/agent/brain.ts), before any keyword rule on WhatsApp and the dashboard:
1. Exact commands (yes/no/approve/1/2/3/book/STOP/OTPs) skip the brain and keep their handlers.
2. Context: last 20 turns, tracked flights, open tasks, approvals, watches, reminders, travel, calendar,
   saved documents, preferences, relevant memories (buildUnderstandingContext).
3. One Claude call with tools: `flight` (live status / track), `reply`, `ask`, `handle`.
   `handle` rewrites the message into an explicit instruction ("it" resolved) for the existing handlers.
4. Safety: the brain never approves, pays or sends. A rewrite may not add consent words. Every handler keeps its
   approvals and Sentinel checks. Any error or timeout (9 s) falls back to today's pipeline unchanged.

Canary: production only, numbers in GOGO_BRAIN_USERS (default: the owner's 8884501501, 8310441698).
Kill switch: GOGO_BRAIN=off. Model: GOGO_BRAIN_MODEL (default claude-sonnet-4-5; benchmark decides later).
Logs: BRAIN_DECISION (kind, ms, rewritten instruction), BRAIN_FAILED.

Next (Phase 1): shadow-run the brain for every user, replay 30 days of chats, then retire keyword routers.
