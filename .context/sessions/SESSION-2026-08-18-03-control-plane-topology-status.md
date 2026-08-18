# SESSION-2026-08-18-03 — Control Plane topology status endpoint

- Status: completed
- Governing issue: https://github.com/nomed/yukh-mcp/issues/248
- Branch: `agent/control-plane-topology-status`

## Objective

Expose a small read-only topology/status endpoint for the local Control Plane
preview so the UI can consume server-owned topology data before live Projects,
Coordination, NATS or manager wiring is added.

## Outcome

- Added `apps/control-plane-preview/src/topology-status.ts` with a closed
  static-preview status model.
- Added `GET /api/topology/status` to the preview server.
- Rejected non-GET methods on that endpoint with `405` and `Allow: GET`.
- Updated the static UI to fetch the endpoint and fall back to local mock data.
- Added regression coverage for endpoint shape, no-store caching, read-only
  method handling, unknown API paths, and topology copy.

The endpoint is static preview data only. It does not read live storage, logs,
credentials, provider output, manager state or worker state.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
