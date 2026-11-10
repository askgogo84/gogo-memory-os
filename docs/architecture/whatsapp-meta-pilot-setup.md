# WhatsApp on Meta Cloud API: pilot setup (owner steps)

Companion to `whatsapp-twilio-to-meta-migration.md`. The code for sending (#1463) and receiving (#1464) is merged and
stays inert until the steps below are done. Nothing here changes the production Twilio number.

Not verified: no live call to Meta has been made from this codebase. The first pilot messages are the first real test.

## 1. What you need from Meta

In Meta Business Suite (business.facebook.com), WhatsApp Manager and the Meta developer app:

| Item | Where it comes from | Goes into Vercel as |
|---|---|---|
| A second phone number registered on Cloud API (not the production number) | WhatsApp Manager > Phone numbers | (not an env) |
| Phone number ID (digits) | Developer app > WhatsApp > API Setup | `GOGO_META_WA_PHONE_ID` |
| Permanent system-user access token with `whatsapp_business_messaging` | Business settings > System users | `GOGO_META_WA_TOKEN` |
| App secret | Developer app > App settings > Basic | `GOGO_META_WA_APP_SECRET` |
| A verify token: any long random string you choose | You invent it | `GOGO_META_WA_VERIFY_TOKEN` |

These are separate from the Tipplr merchant pilot's `META_WA_*` variables. Do not reuse that phone number.

## 2. Vercel environment variables (Production)

| Name | Value |
|---|---|
| `GOGO_META_WA_PHONE_ID` | from step 1 |
| `GOGO_META_WA_TOKEN` | from step 1 |
| `GOGO_META_WA_APP_SECRET` | from step 1 |
| `GOGO_META_WA_VERIFY_TOKEN` | from step 1 |
| `GOGO_WA_META_NUMBERS` | the pilot phone(s) in international format, comma separated |
| `GOGO_WA_PIPELINE_URL` | `https://app.askgogo.in/api/webhooks/whatsapp` (only needed if `TWILIO_WHATSAPP_WEBHOOK_URL` is not already set) |

Leave `GOGO_WA_PROVIDER` unset. Setting it to `meta` moves every user to Meta and is the final cutover, not the pilot.
Leave `WEBHOOK_SIGNATURE_ENFORCE` unset (in production that means strict). Meta media is refused unless it is strict.
Keep all `TWILIO_*` variables as they are. Redeploy after saving.

## 3. Webhook in the Meta developer app

WhatsApp > Configuration > Webhook:

- Callback URL: `https://app.askgogo.in/api/webhooks/whatsapp-meta`
- Verify token: the value of `GOGO_META_WA_VERIFY_TOKEN`
- Subscribe to the `messages` field.

Meta calls the URL once to verify. It succeeds only after the redeploy in step 2.

## 4. Templates in WhatsApp Manager

Needed only for messages sent outside the 24-hour window (reminders, login codes, access granted). Ordinary replies
need none. Create these with language English (`en`). If you pick a different language code, set `GOGO_META_TPL_LANG`
to it. Names can differ if you set the override variable.

| Template name | Category | Body | Buttons | Override variable |
|---|---|---|---|---|
| `gogo_reminder_v1` | Utility | `Reminder: {{1}}` | none | `GOGO_META_TPL_REMINDER` |
| `gogo_reminder_buttons_v1` | Utility | `Reminder: {{1}}` | three quick replies: `Done`, `Snooze 10m`, `Move to 8pm` | `GOGO_META_TPL_REMINDER_BUTTONS` |
| `gogo_login_code_v1` | Authentication | Meta's fixed text with the code as `{{1}}` | copy-code button | `GOGO_META_TPL_AUTH_OTP` |
| `askgogo_access_granted_v1` | Utility | the text of `ACCESS_GRANTED_TEMPLATE_BODY` in `lib/bot/handlers/welcome.ts` | none | `GOGO_META_TPL_ACCESS_GRANTED` |

The body wording of the two reminder templates is a suggestion; match your existing Twilio templates if you prefer.
The button order matters: the code sends the payloads `done`, `snooze_10`, `move_8pm` in that order.

## 5. Pilot tests (from the pilot phone, to the new Meta number only)

| Send | Expected |
|---|---|
| `hi` | A normal reply within about 5 seconds, from the Meta number |
| `remind me to call Divya in 3 minutes` | A confirmation; three minutes later a reminder with Done, Snooze 10m and Move to 8pm (needs the buttons template approved) |
| Tap `Done` | The reminder is marked done |
| A voice note saying "what is on my calendar tomorrow" | A reply to the spoken question |
| A photo of a bill with the caption `save this` | It is saved and confirmed |
| A PDF ticket | It is read and summarised |
| `add a meeting with Nithin tomorrow at 4 pm` | An approval message with Approve and Reject buttons; Approve adds it |

Do not message the production Twilio number from the pilot phone during the pilot: replies follow the person's
provider, so the answer would come from the Meta number.

## 6. Rollback

Remove the phone from `GOGO_WA_META_NUMBERS` and redeploy. That phone is back on Twilio. Removing the four
`GOGO_META_WA_*` variables turns the Meta path off entirely.

## 7. Before the full cutover (not part of the pilot)

- Replace synchronous forwarding with a durable inbox that answers Meta immediately.
- Give Meta media its own credential check so it no longer needs the Twilio variables present.
- Move the production number to Cloud API (plan phase 5), then set `GOGO_WA_PROVIDER=meta`.
