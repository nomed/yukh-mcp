# Run the local suite with Docker Compose

This profile starts the local Yukh runtime needed to inspect and operate the
Control Plane from a browser:

- NATS JetStream;
- Yukh Coordination preview coordinator;
- inert Yukh MCP gateway;
- Yukh Control Plane UI.

It is intended for local evaluation. The container UI is an observer/configuration
preview. To launch real Codex/Copilot workers from your Mac, run the host Control
Plane bridge described below.

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
export YUKH_UID="$(id -u)"
export YUKH_GID="$(id -g)"
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

## Real local workers from your Mac

Docker can start NATS, Coordination and the gateway, but it cannot safely execute
the `codex` and `copilot` binaries installed on your macOS host. For real local
worker runs, keep the runtime services in Compose and run the Control Plane UI on
the host:

```bash
cd /Users/nomed/Code/yulh-workspace/yukh-mcp

export YUKH_UID="$(id -u)"
export YUKH_GID="$(id -g)"
export YUKH_CONVERSATION_WORKSPACE=/Users/nomed/Code/yulh-workspace/yukh-task-board

docker compose -f compose.suite.yaml up -d --build nats coordinator gateway

.github/scripts/start-host-control-plane-macos.sh
```

Open:

```text
http://127.0.0.1:7345
```

If the container Control Plane is already using port `7345`, stop just that
container UI first:

```bash
docker compose -f compose.suite.yaml stop control-plane
.github/scripts/start-host-control-plane-macos.sh
```

This host mode uses the same preview runtime at `.yukh/runtime/local-suite`, the
same NATS JetStream endpoint on `127.0.0.1:14222`, and your host `codex` /
`copilot` executables.

## Stop and clean local state

```bash
docker compose -f compose.suite.yaml down --volumes --remove-orphans
```

This removes JetStream data and Control Plane workspace state created by this
Compose project. The host-readable runtime directory remains under
`.yukh/runtime/local-suite`; remove it only when you want fresh local identities.

## Current limit

The container UI does not launch host binaries. Use the host Control Plane bridge
for real local workers until SDK workers are containerized.
