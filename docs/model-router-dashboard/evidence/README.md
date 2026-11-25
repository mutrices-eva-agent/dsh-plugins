# Visual evidence

All captures use actual DSH Web `0.2.2-rc.5`, dark color scheme, a fresh unauthenticated workspace, and isolated temporary profiles. No real provider requests were made.

## Before

Baseline revision: merged main `3cef52a`, without the model-router dashboard package. Captures show the same default workspace with no **Model routes** sidebar entry.

- `before-1440.png`: 1440×1000 viewport.
- `before-390.png`: 390×900 viewport.

## After

Changed revision: dashboard implementation on the stacked branch based on mockup commit `36f79cb`; the exact final source SHA is the PR head. The isolated profile has the new client and Host package installed. Three fictional routes and bounded fictional v2 metrics provide a populated state; a local mock adapter performs validation without external model calls.

- `after-1440.png`: populated dashboard at 1440×1000.
- `after-390.png`: the same dashboard at 390×900.
- `after-390-scrolled.png`: narrow dashboard after vertical scrolling, showing route health and model rows.

Browser checks also dismissed standard first-run overlays, exercised pause/resume, confirmed automatic routing state changes, and observed no console errors. The final PR head repeats source checks and CI after these captures.
