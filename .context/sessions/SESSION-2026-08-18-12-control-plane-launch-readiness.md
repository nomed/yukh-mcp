# SESSION-2026-08-18-12 — Control Plane launch readiness

- Status: completed
- Governing issue: https://github.com/nomed/yukh-mcp/issues/266
- Branch: `agent/control-plane-launch-readiness`

## Objective

Add a read-only launch readiness check for persisted manager plan previews.

## Outcome

- Added `GET /api/manager-plan/launch-readiness`.
- Added readiness evaluation in `ControlPlanePlanPreviewStore`.
- Reports `ready` only when the latest preview is approved, has a local receipt, has a valid budget split and has budgeted workers.
- Reports `blocked` with concrete reason codes otherwise.
- UI renders a Launch readiness panel for persisted previews and after approval.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright screenshot capture with submit, approve, reload readiness and overflow detection.

## Boundary

Read-only readiness only. No provider call, no worker launch, no Coordination write and no Projects write.
