# WhatsApp booking preview hotfix

## Problem
WhatsApp/Twilio may attach an image thumbnail when a booking URL is forwarded. The thumbnail is preview media, not a user-uploaded document. Treating it as a real image can send it through OCR/asset classification and leak unrelated previous-document context into the reply.

## Acceptance
- BookMyShow / bmsurl.co forwards with image preview media bypass image/document analysis.
- The current forwarded text/link continues through deterministic text routing.
- Booking links are recognized as event bookings and persisted as Life Events.
- Social previews continue through their existing Instagram/LinkedIn/YouTube/TikTok handling.
- Real user images (passport, receipt, food photo, screenshot) remain image inputs.
- A user photo with an incidental URL is not automatically suppressed.
- The exact Mirzapur/BookMyShow payload from the reported production failure is a regression fixture.
