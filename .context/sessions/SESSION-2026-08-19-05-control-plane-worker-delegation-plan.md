# SESSION-2026-08-19-05 — Control Plane worker delegation plan

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-worker-delegation-plan`

## Objective

Add the `prepare_worker_delegation_plan` gate after the manager ready receipt without launching workers.

## Outcome

- Added `GET /api/manager-plan/worker-delegation-plans`.
- Added `POST /api/manager-plan/worker-delegation-plans`.
- Worker delegation plan creation requires an existing manager ready receipt and otherwise fails with `409 manager_ready_receipt_required`.
- Repeated preparation for the same manager ready receipt returns the existing plan.
- Worker plans derive roles and budgets from the existing launch intent.
- Worker inputs are stored as digests only; goal text is not persisted in the plan.
- Worker records include provider, deferred model selection, token budget, command policy and planned status.
- The Control Plane preview UI can prepare and display the worker delegation plan.

## Component boundaries

- MCP / Control Plane owns local lifecycle gates, budgeted worker delegation plans and orchestration receipts.
- Coordination owns agent message transcript and message receipts.
- Projects owns governed work items, policy/admission, roadmap and task metadata.

This increment writes only MCP-local lifecycle state.

## Boundaries

No worker process, provider execution, Coordination write, Projects write, task mutation or roadmap mutation was added.
