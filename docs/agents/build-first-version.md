# Autopilot: DSH Plugins Adapter

This is English workflow configuration for explicit `$autopilot` mode. It is read after the skill entry point. Ordinary tasks keep the gates in `AGENTS.md`; copying, discussing, or testing this workflow does not activate a delivery run.

## Activation and precedence

Activate only when the user explicitly selects `$autopilot`, explicitly invokes `build-first-version`, or clearly asks to run that named workflow for a concrete task.

In this mode only, this adapter replaces intermediate requirement/prototype, plan, test-seam, and ticket-breakdown approval pauses with agent review within the settled scope. Record design references as **agent-reviewed**, never human-approved. Ask about unresolved material business, billing, permission, external-publication, or costly architectural decisions. Preserve answers already given. Regular tasks retain the human mockup gate.

The per-ticket acceptance loop requires an independent read-only critic for every implementation ticket, even without an external comparison artifact. An optional comparison never replaces specification or design criteria.

## Checkout and roles

- Use an authorized isolated feature branch or worktree and one owning committer. Do not edit someone else's checkout or commit directly to `main`.
- The owning agent alone edits product files and commits. Independent reviewers receive no inherited builder conversation, do not edit product files, and do not mutate Git. Missing independent review leaves acceptance unverified.
- Preserve unrelated branches and work. A previous PR that merged or closed is not the target for new work.
- Do not deploy plugins, change active DSH profiles, enable paid probes, or perform financial operations as an implicit delivery step. The endpoint is a reviewed draft PR and passing CI.

## Context and artifacts

Read `AGENTS.md`, the root and affected plugin READMEs, relevant source/tests, and the applicable workflow files. Inspect `docs/adr/` and `DESIGN.md` only when present and relevant.

- Specification: `docs/<feature>/spec.md`; use a short brief for small work.
- Tickets: `docs/<feature>/issues/NN-<slug>.md`, with dependencies, the acceptance bar, evidence, and review verdict. Use `Status:` for triage and `Execution:` for `ready`, `building`, `reviewing`, `accepted`, or `blocked`.
- UI baseline: `mockups/<feature>.html`; use a catalog for multiple surfaces. Serve an inspectable local preview and check relevant narrow/wide layouts and interaction states.
- Reviews and resumption: store evidence with the canonical specification/tickets. Do not introduce per-worker status pages.

Workflow configuration stays in English. Product documentation follows each plugin's existing language pattern.

## Implementation and review

Use `given_X_when_Y_then_Z` behavior tests and reproduce bug fixes with regressions. Preserve exact integer monetary/quota arithmetic, credential boundaries, session compatibility, provider failure semantics, and the default prohibition on paid health probes.

For the model router, run `npm ci && npm run check` from `plugins/model-router`. Re-read `.github/workflows/model-router.yml` and any other affected workflow for the exact check inventory. The current model-router gate is `check`; later plugins own their applicable gates. Local checks, mounted DSH smoke tests, and remote CI are separate evidence.

For UI, inspect the implemented interface as well as the mockup. Capture the same scenario, viewport, theme, and state for before/after evidence. A missing baseline or comparison leaves UI acceptance open.

## Delivery

Commit and push the authorized task, then create or update its intended draft PR. Perform independent Standards and Spec reviews at the final candidate. Verify every applicable check at the final PR head; pending, absent, skipped, cancelled, stale, or failed expected checks do not count as success.

Deliver the business-context and change diagrams, actual check outcomes, inspectable UI when relevant, risks, and evidence limits. Merge, deployment, active-profile installation, paid probes, and real-funds operations remain outside this mode.
