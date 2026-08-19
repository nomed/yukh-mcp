# SESSION-2026-08-19-02 — Control Plane manager runtime connection

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-connect-manager-runtime`

## Objective

Add the `connect_manager_runtime` transition after a planned manager run while
keeping provider process start disabled.

## Outcome

- Added `GET /api/manager-plan/runtime-connections`.
- Added `POST /api/manager-plan/runtime-connections`.
- Runtime connection requires an existing manager run and otherwise fails with
  `409 manager_run_required`.
- Repeated connection for the same manager run returns the existing local
  connection record instead of creating duplicates.
- The connection records provider, manager budget, local receipt,
  `command_policy: not_started`, and `start_manager_process` as the next
  required action.
- The Control Plane preview UI can connect and display the manager runtime
  binding.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Boundaries

No Codex/Copilot process start, worker creation, Coordination write, Projects
write or external mutation was added.
