# Result cards — backend schema

No new tables or migrations.
- Reads `agent_steps.output_json` of a completed `travel_research` run (existing shape: `context`, `flights[]`, `inventoryType`, `browser`).
- `agent_runs.metadata_json.result_card_sent` (boolean) records that the card was accepted by Twilio, so a retried delivery does not resend it.
- Signing secret: existing `CARD_LINK_SECRET` (falls back to `CRON_SECRET`).
