# Ticket Acceptance Loop

## Record the bar before building

Use the repository's ticket format and preserve its existing status vocabulary. The following are fields to fill, not a new parser or a second task database:

```text
Ticket: name and path
Specification: canonical path and relevant requirements
Dependencies: tickets and external prerequisites
Scope / exclusions:
Acceptance bar revision:
Criteria: observable pass/fail conditions, including negative cases
Design baseline: existing artifact and review provenance, when relevant
Required evidence: commands, actual UI states/viewports, integration boundaries
Baseline: fixed commit
Candidate: commit SHA or identified working-tree snapshot
Review: critic identity, verdict, criteria results, evidence, unresolved findings
```

Pair each criterion with evidence the critic can inspect. A BDD name alone is not proof that behavior was exercised. Use real tests, diffs, running interfaces, screenshots, traces, or measured outputs as appropriate. Optional external comparison requires a real artifact and a decidable criterion; ordinary acceptance review always occurs without it.

## Build, test, critique, repair

1. The builder implements a ready ticket and runs the relevant checks. Reproduce reported bugs with a failing regression before fixing them when required by the repository. Preserve test commands, results, and failure artifacts.
2. Freeze an identifiable candidate for review. A commit is simplest; an uncommitted snapshot must include the tracked diff, all relevant untracked files, and content identities. Do not mutate files while the critic examines that snapshot. Private or irrelevant files stay out of the review packet.
3. Start a fresh independent, read-only critic using the supported host mechanism and repository adapter. Do not inherit builder conversation. Provide the original request, relevant user decisions, specification, ticket/bar, repository standards, baseline/candidate, artifact locations, and commands. Avoid telling the critic what verdict to reach or using builder summaries as evidence.
4. The critic inspects actual artifacts, may run safe checks, and reports **Spec** and **Standards** separately. It returns each criterion's result with evidence, actionable failures with requirement references, and clearly labelled optional suggestions. It can write a dedicated review report when the host permits, but cannot edit product files or mutate Git.
5. All unmet acceptance criteria, correctness defects, and applicable hard-standard violations block acceptance. Resolve disputed findings against evidence and the specification. Subjective preferences are optional unless the bar makes them explicit. The builder repairs failures without weakening the bar; the critic then verifies the repair and affected criteria at the new candidate.
6. Accept only after the critic verifies all required criteria and evidence, with no unresolved blocking findings. Record the candidate and report. Do not claim runtime or visual verification from source inspection alone. If a needed preview, test, or independent critic is unavailable, record that missing evidence and leave acceptance open.

For UI, examine the implemented interface, not only its mockup. Check the specified viewports and interaction states against the design baseline. For logic, inspect behavior and negative cases across the real relevant seams, not merely the count of passing tests.

Fresh context is an anti-anchoring measure, not proof of correctness. Tests, source inspection, and observable artifacts complement one another. No reviewer can authorize a new business rule or accept an unrelated scope expansion.

## Progress and exceptions

Continue repair while cycles produce a new supported diagnosis or verified improvement. If the same failure recurs without either, perform one focused diagnosis using a changed hypothesis. If that also makes no progress, record the reproduced failure, attempted hypotheses, evidence, and next diagnostic step; continue unaffected tickets. Ask the user only when a specific user decision or unavailable capability would unblock the work. If the cause is still unknown, say so rather than inventing a missing user input. Preserve a resumable partial result. A stop is not a pass. Do not rerun deterministic failures until a lucky green result appears.

If the bar itself is wrong, show the contradiction. Obtain a decision for material changes; record and version an in-scope clarification. Re-review affected work against the new bar. Never delete a failing case simply to pass.

Later edits can invalidate earlier acceptance. Reopen affected criteria when a shared interface, implementation, test, or baseline changes. A ticket pass is tied to its evidence and revision, not permanently to its ticket number.

## Critic packet

```text
Review this candidate independently. You are read-only; do not edit product
files or mutate Git. Inspect the specification, acceptance bar, standards,
diff and actual artifacts. Run safe relevant checks where available.

Original request and settled decisions: [verbatim material or canonical source]
Specification and ticket: [paths]
Standards: [paths]
Baseline and candidate: [immutable refs or identified snapshot]
Evidence access: [commands, paths, preview URLs]

Report Spec and Standards separately, criterion results with evidence,
blocking findings with source references, optional suggestions, and a verdict.
Missing required evidence means unverified, not pass.
```
