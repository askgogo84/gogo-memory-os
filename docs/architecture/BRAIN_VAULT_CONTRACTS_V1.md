# AskGogo Brain + Vault Contracts v1

## Event Contract

All ingress adapters emit a normalized UserEvent. No adapter may directly claim global intent.

Required fields:
- id
- userId
- surface
- kind
- timestamp
- metadata

Optional payload:
- text
- attachmentRefs
- parentEventId

## Context Contract

Context resolver input:
- current UserEvent
- focus state
- world objects
- recent missions
- recent conversation
- safe Vault metadata

Output:
- resolvedText
- focusObjectIds
- missionId if continuing
- actionFamily
- confidence
- ambiguous flag

Hard rules:
- ambiguity blocks execution
- explicit user-selected object outranks inferred focus
- no secret plaintext in context
- no consequential-action downgrade

## World Object Contract

Every structured entity must record:
- canonical id
- user id
- kind
- typed state
- status
- confidence
- provenance/source events
- evidence ids
- related object ids
- timestamps

Objects are append/update state, not free-form chat summaries.

## Mission Contract

Mission owns the outcome. MissionStep owns capability execution.

A mission must survive:
- surface changes
- provider auth pauses
- approval pauses
- watcher triggers
- process restarts
- planner-provider failover

## Capability Contract

Every capability implements:

```ts
interface Capability {
  name: string
  plan?(input: CapabilityRequest): Promise<CapabilityPlan>
  execute(input: CapabilityRequest): Promise<CapabilityResult>
  verify?(input: CapabilityResult): Promise<Evidence[]>
}
```

Capabilities may not:
- create their own unrelated mission
- bypass approval
- bypass Sentinel
- claim completion without evidence when verification is required
- expose Vault plaintext

## Vault Contract

Brain-facing VaultMetadata:

```ts
type VaultMetadata = {
  credentialRef: string
  provider: string
  domains: string[]
  accountLabel: string
  status: 'active'|'needs_reauth'|'revoked'
  lastUsedAt?: string|null
}
```

Trusted broker only:

```ts
type ResolvedCredential = {
  credentialRef: string
  username: string
  secret: string
  domain: string
}
```

ResolvedCredential may exist only in trusted server-side code and command-scoped sandbox injection.

## Approval Contract

Any consequential MissionStep must have:
- explicit action type
- bounded preview
- risk level
- pending approval id
- revalidation immediately before execute

Approval is invalid if:
- mission/step changed materially
- target provider/object changed
- approval expired
- permission changed
- Sentinel rejects current state

## Evidence Contract

A step that requires verification may transition to completed only when the required evidence class exists.

Examples:
- reminder -> reminder row id
- calendar -> calendar event id
- email send -> provider message id
- watcher -> watcher id
- booking -> provider confirmation / terminal page
- check-in -> boarding pass or verified check-in terminal state

## Watcher Contract

Watcher is linked to:
- world object
- mission
- condition
- cadence
- evidence source
- notification policy

Watcher events re-enter Universal Event Ingress.

## Human Handoff Contract

Human-auth reasons:
- password update
- OTP
- CAPTCHA
- passkey
- biometric
- payment authentication

Handoff must:
- preserve mission id
- preserve browser sandbox/session
- preserve step id
- never leak secret values to chat
- resume through the same policy/evidence path

## Idempotency Contract

Every mutation requires an idempotency key derived from:
- user id
- mission id
- step id
- target object/provider
- normalized mutation intent

Duplicate inbound events must not duplicate:
- reminders
- calendar events
- sends
- bookings
- watcher creation
- payments

## Response Contract

Response composer receives only:
- context resolution
- mission state
- capability results
- evidence summaries
- required user input/approval
- prospective recommendations

It does not inspect raw secrets or raw provider stack traces.
