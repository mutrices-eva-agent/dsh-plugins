# DSH model router

English original. Chinese: [README.zh.md](README.zh.md).

A host-only DSH plugin that scores each new user task from 1 to 5, selects a configured provider/model and reasoning effort, and measures actual token use, latency, cash cost, subscription quota, and optional user feedback. Classification is local and deterministic; it adds no model call.

## Build and install

```sh
cd plugins/model-router
npm ci
npm run check
dsh plugin --profile superagent add "$PWD"
```

Use `--profile desktop` for the desktop profile. Installing the bundle with its default configuration measures main conversation requests without changing models. Add a `model-router` entry to that profile's `cordis.patch.yml` to enable routing; [example.patch.yml](example.patch.yml) is a starting point, not a ready pricing table. Restart DSH if the profile does not use HMR.

## Routing

Each model declares:

- `capability` and `speed`: relative integer scores from 1 to 5.
- `input`: `text`, `image`, or both.
- `reasoningEfforts`: levels accepted by that exact route.
- `contextWindow`: optional input limit used to reject a route whose estimated prompt cannot fit.
- `billing`: either pay-as-you-go prices or a subscription reference with quota weights.

Strategies:

- `balanced`: weighted quality, speed, equivalent cost, and quota preservation.
- `cash`: lowest estimated marginal cash cost, then balanced utility. Subscription requests have zero marginal cash cost.
- `subscription`: available subscription routes first, then lowest estimated quota use.
- `quality`: highest capable score first.
- `speed`: highest speed score first.

The default classifier combines configurable text signals, length thresholds, and attachment weight. `effortByScore` sets the desired effort; a route uses the nearest supported level and prefers the lower level on a tie. At startup, non-dispatching DSH `prepareCall` checks exclude unavailable models and unsupported efforts with warnings. Offloaded images count as text, not vision input. Routing runs when a task is claimed, immediately before DSH reads the step's model selection, so queued tasks receive their own route. Tool continuation steps retain the selected route. If no model fits, the plugin leaves the current selection unchanged and logs a warning.

The default weights are quality 35, speed 20, cash 25, and quota 20. Balanced cost uses pay-as-you-go estimates and, when subscription window cost and quota limit are known, allocated subscription value. Set weights to match the desired tradeoff.

### Superagent workers

With the compatible Superagent fork, add `sourceKinds: [user, dsh-superagent]` to the router profile config and configure eligible `models`. The router considers new worker assignments, not status notices, tool continuations, or ordinary relays. Superagent applies an explicit human model choice before dispatch and marks that message so routing will not replace it. Without an eligible decision, the worker keeps its current model (the Executor model on a new worker).

## Dashboard

The Web client adds **Model routes** to the DSH left sidebar. The dashboard shows actual request totals, outcomes, recent daily output usage, exact cash and current-window quota, route efficiency, user-rated success, and health. Refresh reads the owner-only authenticated host endpoint and never sends a model request. **Pause routing** suspends automatic model selection without stopping metering or health monitoring. Loading, empty, error, narrow, and populated states are supported.

## Commands

- `/model-route` or `/model-route status`: automatic state, current model, and last task decision.
- `/model-route preview <task>`: score and route without sending a model request.
- `/model-route off`: disable automatic routing for this session.
- `/model-route auto`: enable it again.
- `/model-route report`: per-route and current-window usage.
- `/model-route good` or `/model-route bad`: rate the latest measured request in this session.

A finished request is not counted as correct automatically. Rated success uses only explicit `good` and `bad` feedback.

## Accounting

Prices are integer micro-USD per one million tokens. Input, cache-read, cache-write, and output buckets are disjoint. Measurements retain exact integer pico-USD totals and convert only for display, so repeated fractional requests do not lose cash through per-request rounding.

Subscription quota uses exact integer nano-units internally and configured milli-unit weights. Each model can assign request, input, cache-read, cache-write, and output weights. `windowHours` and `windowAnchor` define fixed windows; `quotaLimitMilliUnits` supports quota-aware fallback. Estimated quota is reserved synchronously at admission and replaced by actual usage at settlement, preventing competing tasks in one DSH process from all spending the same remaining allowance. Unused reservations are released at step/turn boundaries and disposal. Usage remains assigned to its admission window if settlement occurs after rollover. A local failure with no provider usage releases its estimate and records zero actual quota. `windowCostMicroUsd` optionally allocates the plan's window price to consumed quota as an exact rational value for equivalent-cost comparisons. This value is not marginal cash spend.

The report separates:

- actual pay-as-you-go cash from subscription usage;
- all-time per-route totals from current subscription windows;
- output tokens per second, cash per 1,000 output tokens, and output tokens per quota unit;
- transport completion from user-rated success.

Metrics are stored as validated versioned JSON at `.model-router/metrics-v2.json` in the active DSH profile by default. DSH's locked atomic-write helper serializes writers and replays pending measurements onto the latest disk state, preventing one process from overwriting another's recorded usage. `lockWaitMs` bounds writer-lock acquisition. A corrupt existing file stops plugin loading and is not replaced. A later write failure is logged and shown in the report.

## Health checks

Passive health monitoring always uses startup validation and real request outcomes. A failed request makes a route degraded; `health.failureThreshold` consecutive failures make it unavailable for selection until `health.retryAfterMs` elapses. Completed requests restore health unless latency reaches `health.degradedLatencyMs`. User cancellation is not a provider failure. Only structured failure codes are retained, never raw provider messages, prompts, responses, or credentials.

Active probes are off by default. Set `healthProbe: true` on an individual model to enable a bounded one-token probe at `health.probeIntervalMs`, with `health.probeTimeoutMs` and `health.probeMaxOutputTokens` limits. Probes are non-overlapping, abort during teardown, and their usage is included in request, cash, and quota accounting. Enabling them can spend money or subscription quota. Dashboard refresh itself never probes.

`dailyRetentionDays` bounds UTC daily usage buckets; old v2 files load with empty daily/health sections and retain all existing totals.

## Offline assessment replay (experimental)

`replayTask` in [src/replay.ts](src/replay.ts) compares the local classifier with saved, normalized advice for the same task, configured routes and quota snapshot. It does not run Jev, choose a route for any live session, or prove an improvement in task success. For a reproducible example, run `node --import tsx --test tests/replay.test.ts` after installing dev dependencies.

Saved advice is `{ difficulty: 1..5, probability: 0..1, needsVision?: boolean }`, not a raw vendor response. Absent, invalid or below-threshold advice uses the local result. A physical image still requires vision, even when advice says otherwise. Confident advice that refers to a needed image with none supplied returns no advised route and flags the missing image. The two outputs show the suggested model and effort, with cash and quota **estimates**, not observed usage. Replay does not reserve quota or import real subscription data.

An optional `subscriptionFirst` replay policy only considers subscription routes marked as verified by the fixture. That mark represents fresh included quota for the serving account and a guarantee against purchased-credit fallback; replay does not check either against a provider. A pay-as-you-go route needs an explicit estimated-cash cap and comparable acceptance evidence for the exact model and effort. It can replace an eligible subscription only if its lower acceptance bound is at least 10× the highest upper bound across eligible subscription routes. Bounds are integer basis points from the same task cohort and acceptance rubric, not Jev confidence or leaderboard scores. Missing or ambiguous evidence, a zero comparison bound, or no eligible subscription comparator cannot justify a paid override. The baseline column still shows existing v1 behavior.

## Limits

- Heaviness scoring is a transparent heuristic, not a semantic model evaluation. Tune `classification` for the workload.
- Route estimates use the new task text and configured output estimates, not the full conversation. Actual reports use provider-reported stream usage.
- Subscription quota is estimated from configured weights. DSH cannot derive a provider's hidden quota rules or plan type from a model name. Missing usage on a failed or aborted stream is treated as zero actual quota.
- Committed metrics merge across DSH processes sharing a profile file. Admission reservations are process-local, so simultaneous task admission in separate processes is not globally serialized.
- Unconfigured routes still report token and latency totals, but no cash, quota, or equivalent value is invented.
- Only agent-loop requests are measured. Auxiliary calls such as session titles are excluded.
- Reasoning tokens are reported in stored metrics but are not billed twice; providers include them in output totals.
