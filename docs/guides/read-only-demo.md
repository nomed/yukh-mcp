# Run the read-only demo

Use this tutorial to see capability discovery, allow, deny, verification, and
evidence in one local run.

## Prerequisites

- Node.js 22 or newer;
- a local checkout of `nomed/yukh-mcp`.

No token, service, container, or configuration is required.

## Run it

```sh
npm ci --ignore-scripts
npm run demo
```

The process exits by itself. In the JSON output, check these fields:

```text
mode: synthetic_local_demo
discovery.tools: [node.inspect]
allowed.structuredContent.result.status: succeeded
allowed.structuredContent.result.verification.status: verified
denied.structuredContent.result.status: denied
denied.structuredContent.result.attempts: 0
evidence_projection[*].durability: in_memory_demo_only
```

The allowed request reads metadata from a temporary fixture. The denied request
never invokes the provider (`attempts: 0`). Cleanup runs before exit.

## What this proves

- MCP discovery can expose one reviewed capability;
- authorization is enforced before provider invocation;
- results and denials use closed structured records;
- verification and evidence are separate from execution.

## What it does not prove

The demo is not an installation profile. It uses no production identity,
policy service, credential, target, or durable audit store. The ordinary
gateway remains inert.
