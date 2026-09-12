# P0 WhatsApp booking preview routing — manual tests

1. Forward the reported BookMyShow Mirzapur message with `bmsurl.co` preview thumbnail.
   - Must return `🎟️ Booking received` and identify the movie/provider.
   - Must not mention passport, names/addresses from an older document, OCR, image note, or file link.
2. Send a real passport image with caption `save my passport`.
   - Must still enter the secure structured asset flow.
3. Send a real restaurant/menu image with an ordinary caption.
   - Must still enter image/note/translation logic as appropriate.
4. Send a real photo whose caption includes an incidental `https://example.com/...` URL.
   - Must remain a real photo; preview suppression must not trigger.
5. Send an Instagram/LinkedIn/YouTube/TikTok preview.
   - Existing social memory handling must remain intact.
6. Send the BookMyShow forward immediately after a passport image.
   - Current booking message must win; no prior passport/media context may appear.
7. Forward a second BookMyShow/event booking.
   - It should be recognized as an event Life Event and must not be analysed as image media.
