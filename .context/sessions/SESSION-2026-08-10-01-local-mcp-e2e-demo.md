# Session - Local MCP/HTTP E2E demo

- Date: 2026-08-10
- Governing issues: https://github.com/nomed/yukh-mcp/issues/11 and
  https://github.com/nomed/yukh-mcp/issues/1
- Status: implementation complete locally

## Objective

Qualify the existing synthetic read-only demo as a deterministic local E2E
through the MCP Streamable HTTP boundary without adding live providers,
credentials, mutation, durable state, or public exposure.

## Outcome

`npm run demo:e2e` now starts the existing fixture-only demo gateway in an
isolated child process on `127.0.0.1` with an ephemeral port. The parent runner
uses `@modelcontextprotocol/client` to discover and invoke `node.inspect`, prove
one explicit allow and one policy deny with zero provider attempts, collect the
closed protected in-memory evidence projection, stop the child, and remove the
temporary fixture before returning success.

The ordinary gateway remains inert. The private Coordination profile remains
separate from gateway and provider paths; its targeted runtime test passed
without a code change, so no speculative fix was applied.

## Validation evidence

- `npm run demo:e2e`: passed in 1.76 seconds;
- targeted gateway, demo, and private Coordination tests: 8 passed;
- `npm run test:runtime`: 221 passed;
- `npm run typecheck -- --pretty false`: passed;
- `npm run build`: passed, including the built demo E2E;
- `npm run format:check`: passed.

## Context impact

This record preserves implementation and validation evidence only. The change
uses the already reviewed issue #11 loopback demo boundary and existing
`node.inspect` contract. It adds process isolation and explicit cleanup
reporting but no new capability, authorization semantics, provider authority,
credential, non-loopback listener, mutation, deployment profile, or production
readiness claim.
