# Ticket 01: Usage history and route health

Status: ready
Execution: building
Dependencies: none
Specification: `docs/model-router-dashboard/spec.md`
Design baseline: no UI in this ticket
Baseline: `2430bf8` (stacked workflow branch)

## Scope

Extend the existing host plugin with backward-compatible daily usage buckets, passive health transitions, configurable recovery/latency/failure thresholds, unhealthy-route exclusion, and optional active probes with lifecycle cleanup and cost accounting.

## Acceptance bar

- Existing v2 metric fixtures load without losing totals.
- Daily buckets aggregate by UTC date and are pruned to the configured retention limit.
- Completed/failed/aborted requests update health according to configured thresholds without counting user cancellation as provider failure.
- Unhealthy routes are excluded until retry eligibility; degraded routes remain selectable.
- Active probes default off; enabled probes are bounded, non-overlapping, recorded in existing cash/quota metrics, and stop on plugin disposal.
- Only structured failure codes are retained; credentials, prompts, responses, and raw provider messages are not.
- BDD regressions cover each criterion and clean `npm run check` passes.

Candidate: pending
Review: pending
