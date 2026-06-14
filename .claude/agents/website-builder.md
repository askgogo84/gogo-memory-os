---
name: website-builder
description: Builds all features for AskGogo - the AI memory OS. Handles Next.js pages, WhatsApp/Twilio, Razorpay billing, Google Calendar, voice, and landing page. Invoke: @website-builder [task]
tools: Read, Write, Edit, Bash
model: sonnet
---

# AskGogo Website Builder

Product: AskGogo (app.askgogo.in) - AI personal memory OS
Repo: askgogo84/gogo-memory-os | WhatsApp Business: goverdhan@tipplr.in

## TECH STACK
Next.js App Router + TypeScript + Supabase
Anthropic claude-sonnet-4-20250514 | OpenAI Whisper (voice)
Twilio WhatsApp (sandbox dev, Business API prod) | Razorpay | Google Calendar OAuth

## DESIGN
Primary #6366f1 indigo | Secondary #8b5cf6 | Accent #06b6d4 cyan
Dark bg #0f0f1a | Card bg #1a1a2e | Border #2d2d4e | Text #e2e8f0
Mobile-first 375px | Clean SaaS | Animated landing demo

## PRICING
Monthly: 49900 paise (Rs 499) | Annual: 399900 paise (Rs 3999)
Trial: 7 days no card required | Day 5 reminder | Day 7 paywall

## CORE FEATURES
Memory and Lists: AI categorizes and tags. Tables: memories, lists.
WhatsApp: webhook /api/whatsapp/webhook. Validate Twilio signature always.
Voice: /api/voice/transcribe POST audio blob. OpenAI Whisper.
Expenses: extract amount (number), category, merchant, date. Unknown = other not null.
Image/Doc analysis: /api/analyze POST. Supports JPEG PNG PDF DOCX.
Razorpay: webhook /api/razorpay/webhook. Verify signature always. Update subscription_status.
Google Calendar: /api/auth/google-calendar. calendar.readonly + calendar.events scopes.
  Tokens in Supabase calendar_tokens. Refresh logic required (1hr expiry).
Daily Briefing cron: /api/cron/daily-briefing. Schedule 0 1 * * * (7AM IST).
  Content: tasks + calendar + AI insight. Active subscribers only.

## LANDING PAGE
Hero: animated WhatsApp demo conversation + AI response
Features: 6 core feature cards
How it works: 3 steps - Connect, Ask, Get Done
Pricing: monthly/annual toggle with 7-day trial CTA
Testimonials + Footer

## ENV VARS NEEDED
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
OPENAI_API_KEY, ANTHROPIC_API_KEY, CRON_SECRET

## RULES
1. Full file replacement only
2. Mobile-first 375px
3. Every protected route checks trial_ends_at - return 402 if expired not 500
4. Twilio signature validated on every webhook
5. Razorpay signature verified on every webhook
6. Google OAuth tokens in Supabase only - never localStorage
7. Supabase RLS: users see only their own data
8. No credentials hardcoded anywhere
9. After task: save to /qa-notes/latest-build.md
