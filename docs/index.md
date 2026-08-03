---
title: Yukh MCP
description: A zero-trust capability gateway for safe agent operations.
---

# Run Yukh MCP locally

Yukh MCP gives agents typed, policy-governed capabilities without exposing
credentials or unrestricted shell access.

!!! warning "Foundation"

    Yukh MCP is not production-ready. The ordinary gateway is inert. The
    supported demo uses only synthetic local data and in-memory evidence.

Requires Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run demo
```

The command needs no credentials or configuration. It runs one allowed
`node.inspect` request and one denial, then exits.

[Run the demo](guides/read-only-demo.md){ .md-button .md-button--primary }
[Understand the architecture](architecture/overview.md){ .md-button }

## Choose a path

- **Evaluate it:** run the [read-only demo](guides/read-only-demo.md).
- **Inspect the process:** start the [inert gateway](how-to/run-inert-gateway.md).
- **Integrate contracts:** use the [contract reference](reference/contracts.md).
- **Review safety:** read the [security model](security/security-model.md).

## Current boundary

Available today:

- versioned capability and authorization contracts;
- network-free validators and fixtures;
- an inert MCP Streamable HTTP gateway;
- a synthetic `node.inspect` demo.

Not available:

- production deployment;
- real credentials or targets;
- operational tools on the ordinary gateway;
- persistent audit storage;
- mutating capabilities.
