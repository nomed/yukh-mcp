# SESSION-2026-08-18-11 — Control Plane plan preview store

- Status: completed
- Governing issue: https://github.com/nomed/yukh-mcp/issues/264
- Branch: `agent/control-plane-plan-preview-store`

## Objective

Persist Control Plane manager plan previews in the local runtime so approved preview state survives refresh.

## Outcome

- Added `ControlPlanePlanPreviewStore`.
- Stores records under workspace `.yukh/control-plane/plan-previews.json`.
- Added `GET /api/manager-plan/previews`.
- Added `POST /api/manager-plan/previews`.
- Redacts goal text to `sha-256` digest in stored/API records.
- UI now loads the latest persisted preview on refresh.
- UI saves proposed and approved-preview records through the local API when available.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright screenshot capture with submit, approve, reload persistence and overflow detection.

## Boundary

Local Control Plane runtime only. No provider call, no worker launch, no Coordination write and no Projects write.
