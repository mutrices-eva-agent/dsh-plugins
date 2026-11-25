# DSH plugins

Independent plugins for DeepSeek Harness.

## Plugins

- [Model router](plugins/model-router/README.md): task-aware model and reasoning selection, subscription and pay-as-you-go accounting, quota reservations, and usage-efficiency reports.

## Development

Each plugin owns its dependencies and checks. For the model router:

```sh
cd plugins/model-router
npm ci
npm run check
```

Build output and dependencies are generated locally and are not committed.

## Autopilot workflow

The repository includes the explicitly invoked [Autopilot skill](.agents/skills/autopilot/SKILL.md) and its [DSH Plugins adapter](docs/agents/build-first-version.md). Use `$autopilot` only when selecting the reviewed first-version workflow. Copying, mentioning, or testing it does not activate a run; ordinary tasks retain their approval gates.

Run the workflow's structural verification with:

```sh
node tests/workflow/build-first-version/verify.mjs
```
