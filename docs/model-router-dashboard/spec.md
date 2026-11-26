# Model router dashboard and health checks

Source request: build the previously absent stats dashboard and provider/model health checks. Dashboard mockup: `mockups/model-router-dashboard.html`, human-approved in interactive trigger `8e77b99e-00c9-46cd-a794-e48c4d63a586` approval `0e74e5d8-751d-4027-b170-e136d97957b2`.

## Requirements

- Show requests, outcomes, token usage, latency, exact cash and quota totals, output efficiency, and user-rated success using existing model-router measurements.
- Add bounded daily usage buckets for the dashboard while retaining existing all-time metrics. Existing v2 metric files must load without migration or data loss.
- Track route health from startup validation and real conversation outcomes. Repeated failures make a route unavailable for selection; recovery retry and latency thresholds are configurable.
- Active provider/model probes are per-route opt-in, disabled by default, bounded by timeout/output limits, and included in cost/quota accounting when enabled. Do not log prompt content, response content, credentials, or raw provider error messages.
- Provide a DSH Web dashboard matching the approved mockup, including loading, empty, degraded/unhealthy, and refresh states. Do not expose private session content.
- Routing skips currently unhealthy configured models and retains the current route when no eligible fallback exists.

## Non-goals

- No automatic installation or activation in user profiles.
- No active probes enabled by default.
- No provider credential management.
- No cross-process global admission lock.
- No deployment or merge by the agent.

## Acceptance evidence

- Behavior tests for backward-compatible metrics, daily aggregation, passive health transitions, routing exclusion/recovery, probe success/failure/cost accounting, and teardown.
- Clean plugin `npm ci && npm run check` and applicable GitHub Actions at the final PR head.
- Before capture at merged main `3cef52a` showing no dashboard, and after captures at the final candidate using the same DSH Web viewport/theme at 1440px and 390px.
- Independent Standards and Spec review of the final candidate.

## Execution

| Ticket | Scope | Dependencies |
|---|---|---|
| 01 | Backward-compatible daily usage and health/probe policy | none |
| 02 | DSH Web dashboard and host projection | 01 |
