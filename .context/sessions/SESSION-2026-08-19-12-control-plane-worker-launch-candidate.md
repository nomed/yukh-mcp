# Control Plane worker launch candidate

Date: 2026-08-19

## Outcome

Added a gated worker launch candidate step to the Control Plane.

## Scope

- Added `GET /api/manager-plan/worker-launch-candidates`.
- Added `POST /api/manager-plan/worker-launch-candidates`.
- Added UI action after provider runtime probe readiness.
- Candidate creation requires:
  - ready provider runtime probe;
  - provider capability inventory;
  - matching worker launch preflight.
- Candidate records approved worker count, worker token budget, allowlisted models and next action.

## Safety boundary

This increment still does not start provider processes, launch workers, write Coordination events or write Projects events.
It records only that the launch is ready for a future explicit launch action.

## Validation

- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `git diff --check`
