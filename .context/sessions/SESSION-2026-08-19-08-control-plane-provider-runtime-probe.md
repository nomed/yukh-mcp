# SESSION-2026-08-19-08 — Control Plane provider runtime probe

Date: 2026-08-19
Repository: `nomed/yukh-mcp`
Branch: `agent/control-plane-provider-runtime-probe`

## Objective

Add the `probe_provider_runtime` gate after worker launch preflight without launching workers or invoking a provider.

## Outcome

- Added `GET /api/manager-plan/provider-runtime-probes`.
- Added `POST /api/manager-plan/provider-runtime-probes`.
- Provider runtime probe requires an existing worker launch preflight and otherwise fails with `409 worker_launch_preflight_required`.
- Repeated probe for the same worker launch preflight returns the existing probe receipt.
- Probe records that the local Control Plane has no configured provider adapter yet.
- Probe records executable and capability inventory checks as not performed.
- The Control Plane preview UI can record and display the provider runtime probe.

## Component boundaries

- MCP / Control Plane owns local provider readiness gates and orchestration receipts.
- Coordination owns agent message transcript and message receipts.
- Projects owns governed work items, policy/admission, roadmap and task metadata.

This increment writes only MCP-local lifecycle state.

## Boundaries

No worker process, provider execution, Coordination write, Projects write, task mutation or roadmap mutation was added.
