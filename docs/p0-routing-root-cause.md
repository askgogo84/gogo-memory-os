# P0 root cause

Twilio supplied a preview thumbnail as `MediaUrl0` alongside forwarded booking text. The webhook prioritized image handling before text routing, so the thumbnail reached OCR/asset classification. The fix introduces a deterministic preview-media guard before image handling and a deterministic booking-link intent before legacy/agent routing.
