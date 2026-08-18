# SESSION-2026-08-18-13 — Control Plane launch intent

Date: 2026-08-18
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-launch-intent`

## Objective

Add the first explicit launch transition after manager plan readiness, without
starting workers or calling providers.

## Outcome

- Added `GET /api/manager-plan/launch-intents`.
- Added `POST /api/manager-plan/launch-intents`.
- Launch intent creation is blocked with `409 launch_readiness_blocked` until
  the latest manager plan preview is launch-ready.
- A launch intent stores only local receipt metadata, the approved preview
  reference, worker budget snapshot and creation time.
- The Control Plane preview UI exposes `Record launch intent` only after
  readiness is `ready`.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Boundaries

No provider call, worker process launch, Coordination write, Projects write or
external mutation was added.
