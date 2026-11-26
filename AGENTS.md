# DSH Plugins Agent Instructions

## Explicit Autopilot mode

Only when the user explicitly invokes [$autopilot](.agents/skills/autopilot/SKILL.md) (formerly `build-first-version`), read [the DSH Plugins adapter](docs/agents/build-first-version.md). In that mode it replaces intermediate design, plan, test-seam, and ticket-breakdown approval pauses with independent agent review and defines host-appropriate previews and mandatory per-ticket acceptance review. Ordinary tasks retain the existing gates. Creating, copying, discussing, or testing the skill does not activate a product-delivery run.

Merge, deployment, provider credential changes, paid health probes, and real-funds operations remain outside autopilot unless separately authorized by the user.

## Repository conventions

- Keep each plugin in its own directory under `plugins/`, with its dependencies, tests, build configuration, and usage documentation.
- Use an isolated feature branch and one owning committer. Preserve unrelated work; do not commit directly to `main` or merge a PR without the user's instruction.
- Add behavior tests for logic changes, using `given_X_when_Y_then_Z` names. Bug fixes need a regression that would fail before the fix.
- Run the applicable [plugin checks](README.md#development) and [Autopilot check](README.md#autopilot-workflow) locally at the final PR head. Record the results in the PR; no GitHub Actions checks are expected.
- Ordinary UI work needs a human-approved in-repo mockup under `mockups/` before implementation. Keep before/after visual evidence at the identified baseline and changed revisions.
- Health checks must not send paid model requests by default. Make active probes opt-in and show their cost implications.
- Never commit provider credentials, request content, or private configuration. Examples use fictional routes and prices.
