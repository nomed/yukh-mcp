# SESSION-2026-08-19-07 — Control Plane worker launch preflight

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-launch-workers-preflight`

## Objective

Add the `launch_approved_workers` preflight gate after worker delegation approval without launching workers.

## Outcome

- Added `GET /api/manager-plan/worker-launch-preflights`.
- Added `POST /api/manager-plan/worker-launch-preflights`.
- Worker launch preflight requires an existing worker delegation approval and otherwise fails with `409 worker_delegation_approval_required`.
- Repeated preflight for the same worker delegation approval returns the existing preflight receipt.
- Preflight records local policy and budget checks as satisfied.
- Preflight records provider runtime and provider capability inventory as still requiring a separate probe.
- The Control Plane preview UI can record and display the preflight.

## Component boundaries

- MCP / Control Plane owns local lifecycle preflight receipts and budget/policy readiness.
- Coordination owns agent message transcript and message receipts.
- Projects owns governed work items, policy/admission, roadmap and task metadata.

This increment writes only MCP-local lifecycle state.

## Boundaries

No worker process, provider execution, Coordination write, Projects write, task mutation or roadmap mutation was added.
