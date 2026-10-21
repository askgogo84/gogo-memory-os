# Core V2 browser boundary attack simulation — 22 October 2026 IST

Source base: main b563a57b6eeaa39aa48d0fdf6bbd1659ae3e3a40. Isolated branch fix/core-v2-browser-url-boundary-oct22. Source fix c50ec071. No production, internal-network, DNS, provider, credential or model requests.

## Confirmed defects and changes

1. URL normalisation turns IPv4-mapped IPv6 into hexadecimal hosts missed by the prior Sentinel. Fallback browser admission also admitted embedded URL credentials and single-label/internal targets. Shared browserTargetUrl now validates public DNS-name HTTP(S) targets before network grants. All IP literals are rejected consistently with managed browser scope. Ordinary initial private IPv4 already failed the old command Sentinel; this is not evidence that every prior runtime accepted it.
2. Read planner actions without references could navigate to invented paths/subdomains. Server-side read validation now requires exact observed href or current-page refresh, including query binding, then validates network admission. Raw observed href stays server-side: redacted planner copies cannot replace or alter it. Unknown destinations stop the wave before later actions.

## Inert adversarial groups

Actual exported Sentinel/allowlist and actual private executor functions (transpiled without changing their implementation) run with inert dependencies. scripts/verify-browser-url-boundary.mts has41 groups:

- Ten unsafe URLs through three boundaries each: mapped loopback, mapped link-local, short IPv4, integer IPv4, trailing-dot localhost, localhost subdomain, internal suffix, metadata/intranet single-label names and userinfo.
- Public target control.
- Fabricated subdomain leak, fabricated same-host path, changed observed query.
- Exact observed absolute link and relative link controls.
- Observed private URL and observed userinfo refusal.
- Standalone refresh and safe search controls.
- Rejected navigation prevents following guessed fill.

RED reproduced original defects, then an independent reviewer reproduced the single-label parity gap (35/41). GREEN41/41. Existing browser-search-controls retains raw-href/redaction assertions and now checks both rejection of unseen navigation and acceptance of observed navigation. VM fixture explicitly loads real Sentinel helpers; no safety assertions are removed.

## Scope and residual risk

The tests prove deterministic admission/observation checks, not successful penetration or provider reachability. An observed link remains untrusted content and cannot authorize a consequential action. Existing action approval/auth gates remain required. Hostname admission alone does not establish DNS resolution/rebinding or redirect egress protection; provider/firewall configuration and a controlled integration test remain required before claiming complete SSRF coverage. Public sites can legitimately link to hostile public hosts; observation is provenance, not proof of safety. No model instruction or page content can mint a recipient/action approval.

## Verification checkpoint

Focused41/41 and existing browser-search-controls PASS. Independent final review and full registered328-command suite/typecheck/build are running at this checkpoint. Production main remains b563a57; branch is not production acceptance. Final exact-head checks belong in the PR and issue274 handoff.
