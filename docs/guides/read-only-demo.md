# Run the local read-only E2E demo

Use this tutorial to cross the real MCP Streamable HTTP boundary with the
official MCP client and see capability discovery, allow, deny, verification,
evidence, and cleanup in one local run.

## Prerequisites

- Node.js 22 or newer;
- a local checkout of `nomed/yukh-mcp`.

No token, service, container, or configuration is required.

## Run it

```sh
npm ci --ignore-scripts
npm run demo:e2e
```

The process exits by itself. In the JSON output, check these fields:

```text
mode: local_e2e
transport.protocol: mcp_streamable_http
transport.binding: 127.0.0.1:ephemeral
transport.server_process: isolated_child
discovery.tools: [node.inspect]
allowed.structuredContent.result.status: succeeded
allowed.structuredContent.result.verification.status: verified
denied.structuredContent.result.status: denied
denied.structuredContent.result.attempts: 0
evidence_projection[*].durability: in_memory_demo_only
cleanup.server_process: stopped
cleanup.fixture: removed
```

The runner starts the demo gateway in an isolated child process on an ephemeral
loopback port. A real `@modelcontextprotocol/client` discovers and invokes
`node.inspect` over HTTP. The allowed request reads metadata from a temporary
fixture; the denied request never invokes the provider (`attempts: 0`). The
runner stops the server and removes the fixture before reporting success.

## What this proves

- a real MCP client can discover one reviewed capability across the HTTP gateway;
- authorization is enforced before provider invocation;
- results and denials use closed structured records;
- verification and protected evidence projections are observable separately from
  execution;
- the child process and temporary fixture are cleaned up deterministically.

## What it does not prove

The demo is not an installation profile. It binds only to `127.0.0.1` on an
ephemeral port and uses no production identity, policy service, credential,
target, provider, mutation, container, or durable audit store. Evidence is
explicitly labeled `in_memory_demo_only`. The ordinary gateway remains inert.
