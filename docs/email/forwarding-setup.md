# Email forwarding inbox

Each person gets `name-xxxxxx@in.askgogo.in` (Settings › Email). Gmail forwards new mail there; Cloudflare Email
Routing hands it to the Worker in `cloudflare/email-worker/worker.js`, which POSTs it to
`https://app.askgogo.in/api/email/inbound` with the shared secret.

## One-time setup
1. Vercel env (Production + Preview): `EMAIL_INBOUND_SECRET` = a random string of 32+ characters.
2. Cloudflare › askgogo.in › Email › Email Routing: enable, then add the subdomain `in.askgogo.in` (Settings ›
   Subdomains). Cloudflare adds the MX and SPF records for the subdomain.
3. Workers & Pages › Create › Worker `askgogo-inbound-email`, paste `worker.js`, add variable
   `ASKGOGO_INBOUND_URL` and secret `INBOUND_SECRET`.
4. Email Routing › Routing rules › Catch-all for `in.askgogo.in` → Send to Worker `askgogo-inbound-email`.
5. Supabase SQL editor (qenhjcooyecmatwducpu): run `supabase/migrations/20261024090000_email_attention.sql`.

## Behaviour
- Gmail's forwarding confirmation code is sent to the person on WhatsApp and shown on Settings › Email.
- The first forwarded mail turns forwarding "on" and Gogo says so once.
- Mail scoring 0.8+ is pushed right away (not 22:00–07:00 except security/cut-off notices; max 6 a day).
- Everything else waits for "emails that need me". Forwarded mail is deleted after 30 days.
