# Gogo TV private market-data connection

## Status

The HTTPS relay lives at \`GET /api/gogo-tv/markets\`, protected by a per-device Bearer token. It returns only fresh, timestamped, licensed market prices; otherwise 401/503 with no quote values. The TV currently runs CleanYourTV Native v3 with weather and the market ticker **OFF** until the user completes private connection.

**Do not merge into production or enable market prices without confirmed data entitlements.** The endpoint cannot supply market prices by itself: it needs a paid/authorized provider account and manual Vercel environment variables.

## Provider

Initial adapter: Twelve Data \`/quote\` (server-side \`Authorization: apikey ...\`). Indices on the user's requested wishlist are not assumed available or assigned unverified symbols. Confirm actual coverage and exchange add-ons via account before configuring each symbol.

Personal home TV only. Do not use for AskGogo customers: this requires a business/display/redistribution agreement. Even a personal subscription can have exchange restrictions.

## Vercel project and domain

Existing Vercel project: \`gogo-memory-os\` (NOT \`askgogo-main\`), team \`goverdhanmd-9559s-projects\`, domain \`app.askgogo.in\`.

Vercel console -> Projects -> gogo-memory-os -> Settings -> Environment Variables. Do not put credentials in the GitHub repository or a chat message. Avoid public/unprotected preview links that expose data.

| Server-side variable | Example/type | What it does |
| --- | --- | --- |
| \`GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256\` | 64 hex chars from Windows pairing script | Only one TV device; never store raw bearer in Vercel. |
| \`GOGO_TV_TWELVEDATA_API_KEY\` | private Twelve Data API key | The provider secret; must remain only on server. |
| \`GOGO_TV_MARKETS_LICENSE_MODE\` | \`personal-display\` | Set ONLY after checking provider's internal display entitlement and any exchange terms. No external distribution. |
| \`GOGO_TV_MARKETS_SYMBOLS\` | JSON array | Selected and verified provider symbol mappings; max eight. |

First proven catalog symbol candidates:

\`\`\`json
[{"label":"GOLD","symbol":"XAU/USD"},{"label":"USD/INR","symbol":"USD/INR"}]
\`\`\`

Confirm \`/quote\` access and last_quote_at timestamps with the actual provider subscription. If a symbol isn't supported, remove it rather than substituting an ETF for an index or inventing a quote. The six Indian/US indices need verified symbol IDs and permission.

## TV flow

1. Verify v3 is installed with fast dock and weather.
2. Run \`Install-GogoMarketsAuth.ps1 -BuildOnly\` and inspect for BUILD SUCCESSFUL.
3. Run \`Install-GogoMarketsAuth.ps1\` once to install the network authorization client; preserves working launcher config.
4. Run \`Prepare-GogoMarketsPairing.ps1\`. It generates a strong device token, stores it in the TV's Android app-scoped theme, and prints only the SHA-256 value for Vercel. The ticker remains OFF. The confidential local file \`config-private.json\` in the backup directory must not be shared or uploaded to GitHub.
5. Add the Vercel environment variables; redeploy a reviewed production version only after explicit approval. Test \`GET /api/gogo-tv/markets\` with no token => 401. Test with authorized TV token when the provider is ready => valid quotes or 503 if data can't be validated.
6. Open TV Launcher Settings -> Markets -> On. The native ticker fetches from \`https://app.askgogo.in/api/gogo-tv/markets\` via \`Authorization: Bearer\` and rotates valid prices every 10 seconds. It doesn't touch dock navigation.
7. Check source name and IST timestamps on the TV; no data -> leave ticker off.

## Security and operations

- Return a 401 for unauthenticated requests before attempting any provider calls.
- Reject data without true \`licensedForDisplay\`, provider name and explicit per-quote timestamps.
- Reject missing/non-numeric changes, stale (>24h) or future quotes and malformed symbols.
- Use a restricted approved set of eight ticker labels and provider-verified mapping.
- Don't mislabel delayed/closed quotes as real time.
- A serverless deployment can have many instances. For multi-TV deployments, implement a durable per-device rate limit and an entitlement registry before launch.
- Never place vendor API keys in TV APK, public URL query strings, repo files, market ticker logs or environment-variable names.
- App-scoped TV config stores a *device* credential; treat backup copy as confidential and rotate the token after compromise.
- This project is a one-TV pilot, not licensed market redistribution to customers.

## Troubleshooting

- TV shows "Connect licensed feed": TV token not prepared or ticker URL not set.
- TV shows "Markets Feed unavailable": provider key/permission missing, wrong symbols, timestamp absent or backend not deployed. Check safe HTTP status, not raw secrets.
- Changing Vercel env vars requires a fresh deployment for the variables to take effect.
- Revert Android APK using the most recent \`previous.apk\` backup and \`adb install -r\` without deleting wallpapers or altering Home accessibility setup.
