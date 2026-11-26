# AskGogo Meetings — Yogurt enterprise integration

**Status (14 Nov 2026): Phase 0 local-only pilot.** Neither AskGogo production nor Yogurt's installed desktop app is modified. No recording, installation, cloud synchronization, tenant ingestion or employee enrolment is automated.

## Current integration boundaries

- [Yogurt](https://github.com/FrigadeHQ/yogurt) is an MIT-licensed local meeting recorder. Its opt-in read-only MCP interface supports list_meetings, get_meeting, get_transcript, search, get_audio. This pilot deliberately never calls get_audio.
- On Windows, the helper uses a local named pipe. There is no per-app access token; access is disabled by default in Yogurt Settings → AI apps. No network-exposed MCP proxy should be created.
- Yogurt has third-party UI and model licence requirements; commercial redistribution requires a complete attribution and licensing review.
- Existing AskGogo code: app/api/meeting/upload/route.ts uploads raw audio for cloud Whisper using a short-lived WhatsApp recorder-link token. Do NOT reuse that link or its HMAC for enterprise desktop authorization or tenant-scoped transcript sync.
- lib/workspaces/access.ts and lib/workspaces/rules.ts implement a read-only workspace pilot with a 50-member limit. Enterprise scale needs an updated tenancy/security design.
- lib/agent/workspace-meeting-approval.ts can inform approval workflows for Calendar actions. It is not an authorization bypass.

## Target commercial architecture

1. Signed Windows/macOS desktop agent with local capture, transcription and offline notes. Start with Yogurt upstream; do not overwrite upstream files until commercial licensing has been reviewed.
2. Optional AskGogo pairing with short-lived tokens bound to device, user and tenant; revocation and offboarding must work. Require server-verified identity rather than client-provided phone numbers.
3. Meeting-by-meeting consent and classification: local private, personal cloud, or explicitly shared company record. Company admins must not automatically gain access to private employee meetings.
4. New authenticated ingestion API for schema-versioned summaries/transcript text, source timestamps, signed consent evidence and idempotency keys. No raw audio by default. Strict size/rate limits and encrypted tenant storage.
5. Provenance-safe organization search with citation links. Never mix tenant data or treat a meeting participant as its owner.
6. Extract owner-attributed commitments with due dates and confidence. Generate drafts, but require the existing AskGogo approval and provider-verification gates before sending email, creating calendar events or touching a CRM.
7. SSO/SAML or OIDC, SCIM/JIT provisioning, roles, seat billing, group policies, data retention/deletion, DLP controls, audit logs, data-residency decisions and support metrics.
8. Signed installers, update signing, managed Windows deployment, fleet rollback and Windows Meet/Teams/Zoom acceptance tests.

## Rollout gates

- **G0**: local exporter mock tests pass; one consenting human verifies Yogurt's Windows recording and the exported notes.
- **G1**: device pairing and authorized tenant upload; expired/revoked tokens fail; no silently uploaded personal data.
- **G2**: cross-tenant / personal-versus-company access, consent revocation, deletion and idempotency fault-injection pass.
- **G3**: 5–10 consenting employees pilot on real Meet, Teams and Zoom, validate accuracy, follow-up approvals and offline behavior.
- **G4**: department deployment (up to 50) with IT security review.
- **G5**: 500-seat rollout only after SSO, provisioning, billing, operations support, security and contracting signoff.

## Operational safety

This project uses only NEW files in tools/yogurt-bridge and this documentation. Do not deploy to production, set new secrets, modify active browser/WhatsApp behavior, change roles, merge unrelated branches, or claim commercial readiness based on mock tests. Coordinate with issue #274 and existing engineering leases.
