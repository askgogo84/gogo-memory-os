# Result cards — App flow

1. Person: "flights Bangalore to Delhi on 12 Nov" (WhatsApp).
2. Gogo replies "Searching…" (unchanged); the travel worker reads Google Flights.
3. Run completes with verified rows.
4. Delivery: image card (top 3, pick highlighted) → text (verdict, rows, "Say book 1", Google link).
5. Person: "book 1" or "book the cheapest" → existing approval → stop at payment.
Failure paths: no card secret / card route error / Twilio media failure → text only, as today.
