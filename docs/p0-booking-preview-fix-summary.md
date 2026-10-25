# P0 booking preview fix summary

The WhatsApp webhook now distinguishes booking/event link-preview thumbnails from real user-uploaded images. Booking preview media is ignored as media so the current text/link proceeds through deterministic booking intent routing. BookMyShow links become event Life Events, while existing social-preview and real-image flows stay intact. The production regression reproduces the exact reported Mirzapur / bmsurl.co pattern and protects against cross-message passport/document contamination.
