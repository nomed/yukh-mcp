# Run the local suite with Docker Compose

This profile starts the local Yukh runtime needed to inspect and operate the
Control Plane from a browser:

- NATS JetStream;
- Yukh Coordination preview coordinator;
- inert Yukh MCP gateway;
- Yukh Control Plane UI.

It is intended for local evaluation. It does not yet containerize Codex or
Copilot worker execution.

## Prerequisites

- Docker Desktop or a compatible Docker engine.
- A sibling checkout of `nomed/yukh-coordination`, or set
  `YUKH_COORDINATION_REPO` to its path.

Expected workspace layout:

```text
yukh-workspace/
  yukh-mcp/
  yukh-coordination/
```

## Start

From `yukh-mcp`:

```bash
docker compose -f compose.suite.yaml up -d --build
```

Open:

```text
http://127.0.0.1:7345
```

Useful endpoints:

```text
Control Plane UI: http://127.0.0.1:7345
Gateway readyz:   http://127.0.0.1:3000/readyz
NATS client:      127.0.0.1:14222
Coordination:     127.0.0.1:7443
Supervisor:       127.0.0.1:7444
```

## Check status

```bash
docker compose -f compose.suite.yaml ps
```

The Control Plane “Real project readiness” panel should report runtime and
JetStream gates from inside the Compose network.

## Stop and clean local state

```bash
docker compose -f compose.suite.yaml down --volumes --remove-orphans
```

This removes the local preview runtime volume, JetStream data and Control Plane
workspace state created by this Compose project.

## Current limit

This Compose profile starts the suite runtime and UI. Real Codex/Copilot worker
execution still needs the next provider-runner increment: either SDK-based
workers inside containers or an explicit host runner bridge.
