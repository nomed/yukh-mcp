# SESSION-2026-08-18-02 — Control Plane runtime topology preview

- Status: completed
- Governing issue: https://github.com/nomed/yukh-mcp/issues/246
- Branch: `agent/control-plane-runtime-topology`

## Objective

Make the local Control Plane preview explain how Yukh Projects, Yukh MCP,
Yukh Coordination, managers, workers and NATS JetStream relate, without adding
live runtime wiring or deployment authority.

## Outcome

- Added a `Runtime topology` section to the Control Plane preview.
- Added an inline SVG topology map rather than Mermaid.
- Added mock topology panel data for Projects governance, orchestration,
  Coordination and JetStream runtime ownership.
- Added a regression test that verifies the preview explains Projects, MCP,
  Coordination, JetStream and the evidence-not-authority rule.

The view is static preview data only. It does not read live Projects,
Coordination, NATS, manager or worker state.

## Validation

- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `npm run format:check`
- `npm run typecheck`
- `git diff --check`
