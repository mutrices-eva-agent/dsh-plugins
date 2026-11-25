# Ticket 02: DSH Web dashboard

Status: ready
Execution: accepted
Dependencies: 01
Specification: `docs/model-router-dashboard/spec.md`
Design baseline: `mockups/model-router-dashboard.html`, human-approved
Baseline: `2430bf8` plus ticket 01 candidate

## Scope

Expose a read-only dashboard projection from the host plugin and add a DSH Web client page matching the approved mockup. Include loading, empty, error, refresh, route-health, and active-probe states.

## Acceptance bar

- Dashboard values come from actual host metrics; no duplicated client-side accounting.
- No request content or credentials cross the host/client boundary.
- Empty and partial historical data are explicit; old metrics do not fabricate a daily history.
- Refresh and plugin disposal clean up subscriptions.
- Approved layout is inspected at 1440px and 390px in DSH Web with before/after evidence.
- Clean build/checks and final-head CI pass.

Candidate: `dccec53`
Review: PASS — independent Spec review confirmed all six defects repaired and exact-value/30-day evidence adequate; independent Standards review found no remaining correctness blocker. Actual DSH Web 0.2.2-rc.5 captures at 1440px/390px, pause/resume, empty/populated states and narrow vertical scrolling passed without console errors.
