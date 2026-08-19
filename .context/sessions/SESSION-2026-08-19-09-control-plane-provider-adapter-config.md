# Control Plane provider adapter configuration

Date: 2026-08-19

## Outcome

Added a bounded Control Plane provider adapter configuration step before provider runtime launch.

## Scope

- Added local provider adapter records for supported manager/worker providers.
- Added `GET /api/manager-plan/provider-adapters`.
- Added `POST /api/manager-plan/provider-adapters`.
- Added UI controls to configure provider, adapter kind, executable path, model list and max run token budget.
- Updated provider runtime probes so they can distinguish:
  - missing adapter;
  - configured SDK adapter;
  - missing CLI executable;
  - executable CLI adapter.

## Safety boundary

The increment still does not launch provider processes, workers or external writes.
It only records local configuration and performs a local executable-path check for CLI adapters.

## Validation

- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `git diff --check`
