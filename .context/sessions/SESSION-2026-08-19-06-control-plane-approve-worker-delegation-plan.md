# SESSION-2026-08-19-06 — Control Plane approve worker delegation plan

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-approve-worker-plan`

## Objective

Add the `approve_worker_delegation_plan` gate after worker delegation plan preparation without launching workers.

## Outcome

- Added `GET /api/manager-plan/worker-delegation-approvals`.
- Added `POST /api/manager-plan/worker-delegation-approvals`.
- Worker delegation approval requires an existing worker delegation plan and otherwise fails with `409 worker_delegation_plan_required`.
- Repeated approval for the same worker delegation plan returns the existing approval receipt.
- Approval records worker count, approved worker token budget, local-only scope, and the next required action `launch_approved_workers`.
- The Control Plane preview UI can approve and display the worker delegation approval.

## Component boundaries

- MCP / Control Plane owns local lifecycle approvals and budgeted orchestration receipts.
- Coordination owns agent message transcript and message receipts.
- Projects owns governed work items, policy/admission, roadmap and task metadata.

This increment writes only MCP-local lifecycle state.

## Boundaries

No worker process, provider execution, Coordination write, Projects write, task mutation or roadmap mutation was added.
