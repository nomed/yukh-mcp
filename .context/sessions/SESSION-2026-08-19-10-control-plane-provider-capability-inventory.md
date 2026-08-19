# Control Plane provider capability inventory

Date: 2026-08-19

## Outcome

Added a bounded provider capability inventory step after provider adapter configuration.

## Scope

- Added `GET /api/manager-plan/provider-capability-inventories`.
- Added `POST /api/manager-plan/provider-capability-inventories`.
- Added UI action to inventory capabilities from the configured adapter.
- Records model names and max run token budget from local adapter configuration.
- Invalidates old capability inventory when a provider adapter is reconfigured.

## Safety boundary

This increment does not invoke Codex, Copilot, SDKs, CLIs or worker processes.
The inventory source is the local provider adapter config only.

## Validation

- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `git diff --check`
