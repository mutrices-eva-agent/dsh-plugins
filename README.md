# DSH plugins

Independent plugins for DeepSeek Harness.

## Plugins

- [Model router](plugins/model-router/README.md): task-aware model and reasoning selection, subscription and pay-as-you-go accounting, quota reservations, and usage-efficiency reports.

## Development

Run verification locally with Node.js 22.19.0 or newer. Each plugin owns its dependencies and checks. For the model router:

```sh
cd plugins/model-router
npm ci
npm run check
```

Build output and dependencies are generated locally and are not committed. Record local verification results and the tested revision in the PR; no GitHub Actions checks are expected.

## Autopilot workflow

The repository includes the explicitly invoked [Autopilot skill](.agents/skills/autopilot/SKILL.md) and its [DSH Plugins adapter](docs/agents/build-first-version.md). Use `$autopilot` only when selecting the reviewed first-version workflow. Copying, mentioning, or testing it does not activate a run; ordinary tasks retain their approval gates.

If the Autopilot workflow changes, run its structural verification from the repository root:

```sh
node tests/workflow/build-first-version/verify.mjs
```
