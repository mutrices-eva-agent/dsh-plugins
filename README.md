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
