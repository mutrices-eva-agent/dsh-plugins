# Integration, PR, and Explanation

## Integration gate

After individual tickets pass, test the complete user journey and cross-ticket contracts. Select checks from the current repository instructions and actual change, including applicable permission, state, persistence, recovery, and error boundaries. Retain required coverage; do not remove a failing check to make this workflow finish.

Obtain independent final reviews of the full change along both Standards and Spec axes. Supply the fixed base, current candidate, original request, canonical specification, and standards directly; do not ask the user for information already recorded. Read-only reviewers can run in parallel. Reuse a ticket review as the final review only when the task has one ticket and the candidate, full scope, and review criteria are identical; record that equivalence. Otherwise perform the cross-ticket review separately.

Repair findings and repeat the affected verification/review. Tie final evidence to the final candidate. A source-only review does not replace required runtime checks.

## PR and verification gate

1. Inspect repository, branch, remote, dirty changes, and existing PR state. Use the intended open PR; if it was merged or closed, use a suitable new feature branch and draft PR. Preserve unrelated changes and avoid publishing private test inputs or credentials.
2. Only the owning builder commits and pushes. Describe the final behavior, reason for the change, verification, and material limits. Use structured body arguments or a body file to preserve exact text.
3. Identify required checks and where they run from the repository adapter, verification instructions, and branch requirements. For local checks, run them against the final PR head and record commands, results, and commit. When hosted checks are required, verify their run SHAs and successful completion, including dependent jobs. Record why any check does not apply.
4. Diagnose failures from logs/artifacts. Repair implementation failures and re-review affected work before pushing. Retry a transient infrastructure failure only when evidence supports that diagnosis. Pending, missing, cancelled, or skipped expected checks leave the delivery gate open. Changes to the head invalidate earlier verification.
5. Read back the final PR head and confirm all applicable verification covers it before announcing completion. If access is unavailable, retain a partial result with the precise next action; do not invent a PR, substitute local tests for remote CI, or silently change the delivery target.

A controlled evaluation can provide a fake hosting/CI boundary when explicitly specified by its harness. Label those observations simulated; they cannot establish live hosting or CI acceptance. Runtime permissions and user scope still apply to real operations.

## Diagram-led delivery

Write in the conversation language; keep skill instructions and workflow configuration in English. Follow this narrative, with a small set of reusable diagrams rather than a file-by-file report:

1. **Business context:** participants, goals, rules, and the complete relevant journey. Offer deeper background when needed without surveying unrelated parts of the product.
2. **Before:** the prior behavior and why the problem occurred, with source references. Distinguish verified causes from hypotheses.
3. **After:** the new behavior, a concrete worked example, and the main code boundaries that make it work.
4. **Evidence:** ticket and integration outcomes, final PR link, check evidence, and head, inspectable UI, and what remains unverified. Keep local checks, remote CI, deployed observation, and live external-service acceptance distinct.
5. **Risks and adjustment options:** current choices, rationale, uncertainty, affected behavior, alternatives, and cost of changing them. Separate optional refinements from unresolved acceptance blockers.

Use `explain-diff-html`'s background/intuition/change narrative when available. A self-contained HTML explanation is useful for a substantial change; inline diagrams suffice for a compact change. Quizzes are optional. Include the actual interface or runnable preview for UI changes, not only a conceptual diagram.

Invite feedback on the delivered first version. Carry accepted decisions and authorization into subsequent iterations, update only affected requirements/tickets, and repeat the relevant review and checks. Do not merge or deploy as an implicit next step.
