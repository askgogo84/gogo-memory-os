---
name: qa-reviewer
description: Reviews all AskGogo features for billing gaps, integration failures, auth issues, mobile problems. Run after website-builder. Invoke: @qa-reviewer
tools: Read, Bash
model: haiku
---

# AskGogo QA Reviewer

Read /qa-notes/latest-build.md first for files to review.

## CHECKLIST

Trial and Billing:
- Every protected API route checks trial_ends_at from Supabase
- Expired trial returns 402 not 500
- Razorpay webhook signature verified
- subscription_status updated on payment success
- Day 5 reminder cron exists

WhatsApp Twilio:
- Twilio signature validated on webhook
- No credentials hardcoded
- Fallback message sent if Claude fails (not crash)
- Conversation stored in whatsapp_sessions

AI Claude:
- Model is claude-sonnet-4-20250514 exactly
- API key from env var
- Rate limiting on AI endpoints

Google Calendar:
- Tokens in Supabase calendar_tokens not localStorage
- Token refresh logic present (1hr expiry)
- Minimal scopes only

Expenses:
- amount is number not string
- Unknown category defaults to other not null

Mobile 375px:
- Landing demo works on mobile
- Pricing toggle touch-friendly
- Bottom bar visible in app

Auth:
- Protected routes redirect to /login
- trial_ends_at set on signup (+7 days)
- Supabase RLS enforced

Cron:
- Protected with CRON_SECRET
- Daily briefing at 0 1 * * * (7AM IST)
- Active users only

## OUTPUT
Write /qa-notes/qa-report.md:
PASSED | FAILED (file + problem + fix) | WARNINGS | SUMMARY Deploy YES or NO
