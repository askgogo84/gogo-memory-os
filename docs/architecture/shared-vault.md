# AskGogo shared Vault architecture

## Product rule

The Vault is shared infrastructure, not a WhatsApp-only or dashboard-only feature.

Every AskGogo surface references the same user-scoped credential records:
- WhatsApp
- Dashboard / Talk to Gogo
- mobile app
- Agent Browser
- Background Gogo / watchers
- scheduled autonomous runs

The model receives only opaque credential references such as `instagram-personal`. Raw usernames/passwords must never be inserted into model prompts, memory, Activity, agent-step output, logs, or ordinary chat.

## Authentication priority

For every provider, use the safest / most stable option in this order:

1. Official OAuth/API connection where available and appropriate.
2. Existing persistent authenticated browser session.
3. Vault credential injected by the secure browser through the credential broker.
4. Human Take Control for MFA, CAPTCHA, passkey, security challenge, or payment authentication.

## Google Workspace exception

Gmail/Drive/Contacts/Calendar should stay on OAuth/API integrations.

Google's APIs support offline/background work through OAuth refresh tokens. AskGogo should NOT replace Gmail OAuth with stored Google passwords and browser automation.

The same underlying secret-storage primitives may eventually hold encrypted OAuth refresh tokens and website credentials, but they remain different connector types:
- Google Workspace = OAuth connection
- Instagram / retailer / provider without usable API = Vault credential + browser

## Components

### vault_credentials
Service-role-only encrypted credential records.

Never expose ciphertext directly to authenticated/anonymous clients. Dashboard metadata is returned through server routes only.

### vault_audit
Non-secret lifecycle/use events:
- credential_saved
- credential_updated
- credential_removed
- credential_resolved
- credential_domain_denied
- login_success / login_failed (later)

Never store secret values in the audit trail.

### Credential broker
Internal server-only function:
`resolveVaultCredentialForDomain({ telegramId, credentialId, domain })`

It:
1. validates user ownership,
2. validates status,
3. enforces allowed-domain binding,
4. decrypts inside the trusted backend boundary,
5. records an audit event,
6. returns the secret only to the trusted browser executor.

### Secure browser
The browser will later receive an opaque credential reference, not raw secret text from the model. It resolves the credential server-side and injects it directly into matching login fields.

Secrets must never be passed:
- in CLI arguments,
- in browser task objectives,
- in model-generated action JSON,
- in logs,
- in page summaries.

Use stdin / protected environment or another non-logged process channel for browser injection.

### Persistent session
After successful login, reuse the persistent browser profile/session. Vault decryption should be fallback, not the first action on every run.

### Human auth
OTP, CAPTCHA, passkey and payment authentication stay in the provider browser through Take Control. AskGogo never asks the user to paste them into chat or Activity.

## UI integration

### Connections + You
Add:
- Connected apps
- Vault

Vault metadata cards show:
- provider
- account label
- masked username hint
- allowed domain(s)
- status
- last used
- update
- remove
- re-authenticate

Never show saved passwords.

### Contextual entry
If a browser task reaches a login wall and no usable session/credential exists:
- WhatsApp: secure `Add login` link
- Dashboard: `Add login` action in Agent Browser
- mobile: same secure form
- background task: pause as `Needs you` and notify

After saving, the original run may resume using the same task context.

## Phases

### V1 — foundation
- encrypted storage
- domain binding
- audit
- metadata-only list
- save/update/remove
- secret never reaches client after save

### V2 — browser broker
- credential reference on browser task
- direct browser field injection
- login success/failure detection
- persistent session reuse
- no model access to secret

### V3 — contextual UX
- secure Add Login form
- Connections + You / Vault
- WhatsApp secure-link handoff
- Agent Browser resume

### V4 — background use
- watchers can reuse authenticated sessions
- expired login becomes Needs You
- resume after re-authentication
- provider-specific policies

## Consequential-action boundary

Vault possession does not imply permission to perform every action.

Read/search/compare: generally autonomous.
Watch/monitor: autonomous after user request.
Draft/add-to-cart: only when user requested it and reversible.
Send/submit/book/purchase: approval required.
Payment/bank auth/OTP/passkey: human control required.
