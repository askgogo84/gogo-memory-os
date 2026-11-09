# Result cards — PRD

Approved mock: claude.ai/artifact/7QYg2NZYTaBfCkWMYEHZhQ (owner approved 27 Oct 2026, 09:30 IST).

## Problem
Flight (and later hotel, restaurant, shopping) results arrive on WhatsApp as a long numbered text list. Instinct sends picture cards and names a pick; ours are harder to scan.

## Goal
1. WhatsApp: one image card with the top 3 options and Gogo's pick, then a short text with every row, "book N" and the source link.
2. Dashboard: a results page (cards, filters, map pins for places) opened from a link in that text.

## Users and jobs
- Divya searches "flights Bangalore to Delhi on 12 Nov" on WhatsApp and wants to see the best three at a glance and book one with "book 1".
- Nithin opens the link on his laptop to filter by morning flights or see hotels on a map.

## Scope
- Phase 1: WhatsApp flight card (one-way). Phase 2: dashboard flights page. Phase 3: round trips. Phase 4: hotels (needs a live price source). Later: restaurants, shopping.
- Out of scope: model-generated layouts, any new provider key, any change to booking approval.

## Must hold
- Every fare and time on a card is a row Gogo already verified on Google Flights; nothing is re-typed by a model.
- The card is a best-effort extra: if it cannot be made or sent, the person still gets the full text result.
- Card links are signed per owner and run; nobody else can open them.
- Light theme, readable at 375 px.

## Success
- A flight search on WhatsApp shows the card within the same delivery as today.
- "book 1" books the card's row 1.
