# Control Plane worker launch receipt

Date: 2026-08-19

## Outcome

Added a local explicit worker launch receipt step after launch candidate readiness.

## Scope

- Added `GET /api/manager-plan/worker-launch-receipts`.
- Added `POST /api/manager-plan/worker-launch-receipts`.
- Added UI action from worker launch candidate.
- Receipt records local launch authorization and the next required action.

## Safety boundary

This receipt still does not start provider processes, launch workers, write Coordination events or write Projects events.
It records only that the Control Plane has explicitly authorized a future provider worker process start.

## Validation

- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `git diff --check`
