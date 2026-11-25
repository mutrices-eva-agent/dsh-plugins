---
name: autopilot
description: Deliver a reviewed first version through a draft PR and passing CI, with minimal conversation, independent review of every ticket, and a diagram-led explanation. Use only when the user explicitly selects this workflow.
---

# Autopilot

Complete one logical delivery effort, then explain the working result so the user can iterate. Explicit selection of this workflow delegates routine in-scope decisions and authorizes its read-only reviewers, implementation, tests, commits, pushes, and draft-PR delivery. Respect narrower user instructions, runtime permissions, and repository restrictions. Merge, deployment, and real-funds operations are outside this workflow.

This entry point owns the stages below. Reuse useful skill methods rather than invoking interactive command chains that ask for the same approvals again. Keep other skills' invocation policies unchanged. Mentioning or evaluating this skill is not invoking it.

## 1. Establish context and execution boundaries

Read the repository instructions and `docs/agents/build-first-version.md` if present; this is the repository adapter. Discover the current checkout, dirty changes, base commit, relevant PR state, domain terminology, decisions, code paths, tests, and integrations. Preserve unrelated work. Use an authorized isolated feature checkout and its single owning committer.

Trace the relevant business journey: participants, intended outcome, rules, state or money flow, existing behavior, and affected boundaries. Verify facts from sources and code; distinguish facts from assumptions. Stop exploration when that journey and observable acceptance conditions can be stated and remaining uncertainty is classified.

Check that independent reviewers, the required verification tools, and PR/CI access exist. Use available purpose-built connectors or CLIs without assuming a particular vendor command. Missing capability is an explicit prerequisite, never invented evidence.

Done when the objective, scope, sources, repository/base, constraints, and available verification path are recorded in the repository's canonical specification or task document.

## 2. Resolve only material uncertainty

A material decision is an unresolved choice affecting the intended outcome, business rules, money semantics, permissions, external commitments, acceptance criteria, or expensive-to-reverse architecture. Reuse explicit answers and established rules. Investigate discoverable facts yourself. Decide reversible implementation details within scope and record consequential assumptions.

- No material decisions: proceed without a confirmation ritual.
- One to three with simple dependencies: ask the current decision frontier together, with recommendations; wait for answers before dependent work.
- More than three, or tightly coupled decisions: maintain a requirements document and clarify in dependency order until the material frontier is empty. Establish agreement on the resulting requirements before dependent implementation.

The count changes the conversation format, not the importance of a decision. A single unresolved financial rule still requires an answer. If new evidence later exposes a material decision, reopen that decision and continue independent work where possible.

Done when the specification states the agreed behavior, exclusions, acceptance conditions, decisions, and remaining nonblocking assumptions. A short task needs a short specification, not an additional planning ceremony.

## 3. Prepare design and tickets

Create a prototype only when required by the repository or useful for answering a concrete UI/state question. Use the existing design system and cover relevant loading, empty, error, disabled, and recovery states. Apply the adapter's review policy: where explicitly authorized, review the prototype autonomously and label it **agent-reviewed**, never human-approved. Otherwise honor the repository's human gate. A prototype is a reference, not automatically production code.

Split into cohesive, independently verifiable behavior slices, with dependencies. Use the repository's ticket location; otherwise use `docs/<feature>/issues/`. Keep one canonical specification. Include a small execution table there when resumption requires it; avoid a separate worker dashboard or redundant plan.

Before implementation, lock each ticket's scope, requirement references, design baseline, observable acceptance criteria, negative cases, and required evidence. Use the ticket record in [ticket-loop.md](references/ticket-loop.md). Resolve material contradictions; routine test seams and ticket granularity are delegated choices.

Done when a ready ticket has satisfied prerequisites and an inspectable acceptance bar that is independent of its future implementation.

## 4. Build and critique every ticket

Read [ticket-loop.md](references/ticket-loop.md) and run its builder/test/critic/repair cycle for **every** implementation ticket, even when no external comparison artifact exists. Use actual BDD and regression checks required by the repository. Only the owning builder changes and commits product files; critics inspect and report.

Read-only research and independent reviewers may run concurrently when resources and repository rules allow. Serialize mutations unless the repository explicitly provides safe ownership boundaries. Keep progress updates informational; do not ask the user to approve routine next steps.

Done when every in-scope ticket has a pass backed by evidence at its recorded candidate and all acceptance blockers are resolved. Optional suggestions do not expand scope. A blocked or interrupted ticket remains unaccepted.

## 5. Integrate and deliver

Read [delivery.md](references/delivery.md). Verify the complete journey across tickets, perform independent Standards and Spec review of the full change against the fixed base, and repair findings. Revalidate tickets affected by later changes.

Commit and push the intended change, create or update the relevant draft PR, and wait for all applicable checks at the **final PR head**. Follow the repository's expected gate inventory; absent, pending, skipped, cancelled, failing, or stale checks do not count as success. When an existing intended PR is already marked ready, preserve its state unless the user requested conversion; do not silently demote it. Reuse an open intended PR, never append new work to a merged PR.

Done when the final review, local verification, and applicable remote CI all cover the delivered head, and the diagram-led explanation is available with the draft PR and evidence links. Stop short of merge, deployment, and real funds.

## Resume or hand off an incomplete result

Persist decisions, base/head, ticket states, artifact locations, and the exact next action in the existing specification/tickets. On resumption, verify them against the actual checkout, PR, and CI before continuing; invalidate stale acceptance. Context compaction does not reset authorization or completion criteria.

If a prerequisite or permission remains unavailable, state the concrete blocker, completed work, unverified criteria, and resumption action. Keep the result explicitly partial. A runtime limit, missing reviewer, or missing CI cannot be converted into a successful first version.
