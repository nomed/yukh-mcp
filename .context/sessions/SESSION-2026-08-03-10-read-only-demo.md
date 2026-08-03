# Session — five-minute read-only demo

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/11
- Branch: `agent/issue-11-read-only-demo`
- Status: implementation complete locally; draft PR pending

## Outcome

Added `npm run demo`, which creates a synthetic temporary node fixture, starts
the gateway on loopback and an ephemeral port, connects an MCP client,
discovers the demo-only `node.inspect` tool, executes an explicit allow and an
explicit deny, prints bounded structured results plus protected in-memory
evidence projections, and tears everything down.

The default gateway server factory remains inert. Demo authority is isolated in
the demo entry point and cannot select a production root, credential, provider
method, command, or mutation.

## Boundary

The evidence is labelled `in_memory_demo_only` and is not durable RFC-0004
audit. No authentication profile, production policy adapter, credential,
provider deployment, persistent state, mutation, or production MCP tool is
introduced.
