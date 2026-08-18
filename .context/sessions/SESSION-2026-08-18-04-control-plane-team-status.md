# SESSION-2026-08-18-04 — Control Plane live team status

- Status: completed
- Governing issue: https://github.com/nomed/yukh-mcp/issues/250
- Branch: `agent/control-plane-topology-status`

## Objective

Expose the first safe live Control Plane status: local team supervisor state,
without exposing private goals, task text, logs, credentials, provider output
or mutable operations.

## Outcome

- Added `apps/control-plane-preview/src/team-status.ts`.
- Added `GET /api/teams/status` to the local preview server.
- Added optional `--workspace` plus `YUKH_CONVERSATION_WORKSPACE` /
  `YUKH_TEAM_WORKSPACE` discovery for local team state.
- Updated the preview UI to load live team summaries and fall back to static
  mock teams.
- Returned only redacted team summaries: identifiers, manager runtime/role,
  goal digest, agent roles/states/runtime, Coordination participant, aggregate
  token counters, receipt count and plan status.
- Rejected non-GET methods with `405` and left unknown API paths as `404`.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Boundary

This increment reads local `.yukh/teams` state through the existing TeamStore
shape. It does not start, stop, approve, inspect logs, contact Coordination,
contact Projects, contact NATS, invoke providers or expose secrets.
