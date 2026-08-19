# SESSION-2026-08-19-03 — Control Plane start manager process

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-start-manager-process`

## Objective

Add the `start_manager_process` transition after a manager runtime connection,
with hard token cap recorded before any worker delegation.

## Outcome

- Added `GET /api/manager-plan/manager-processes`.
- Added `POST /api/manager-plan/manager-processes`.
- Manager process creation requires an existing runtime connection and
  otherwise fails with `409 runtime_connection_required`.
- Repeated start for the same runtime connection returns the existing local
  process record instead of creating duplicates.
- The process records `state: starting`, provider, hard token cap, local
  receipt, `provider_process: pending_provider_runner`,
  `worker_delegation: disabled_until_manager_receipt`, and
  `record_manager_ready_receipt` as the next required action.
- The Control Plane preview UI can start and display the manager process state.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Boundaries

No provider subprocess, worker creation, Coordination write, Projects write or
external mutation was added. The provider process remains explicitly pending
until a provider runner is connected.
