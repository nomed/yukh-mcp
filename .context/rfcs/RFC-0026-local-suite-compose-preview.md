# RFC-0026 — Local suite Compose preview

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-20
- Accepted: 2026-08-20
- Decider: project owner
- Governing issue: pending
- Depends on: RFC-0017, RFC-0020, RFC-0025

## Decision

Add a local Docker Compose profile that starts the services an operator needs to
open the Control Plane and inspect the local Yukh runtime from a browser:

- NATS JetStream;
- Yukh Coordination preview coordinator;
- inert Yukh MCP gateway;
- Yukh Control Plane preview UI.

The profile is a local preview topology. It is not a production deployment and
does not broaden gateway authority.

## Boundaries

The Compose profile may create local Docker volumes for:

- preview Coordination runtime material;
- JetStream data;
- Control Plane workspace state.

The profile must not bake credentials into images or repository files. Runtime
TLS, supervisor token and receipt signing material are generated inside a local
Compose volume by a one-shot init service.

The Control Plane runtime check is container-native. It verifies the Compose
runtime from inside the Compose network and must not require Docker access from
inside the Control Plane container.

## Worker execution

The Compose profile starts runtime and UI only. Real Codex/Copilot worker
execution remains a separate provider-runner concern. The next accepted
increment must choose one of:

- SDK-based workers running inside containers with explicit credential delivery;
- an explicit host runner bridge with bounded authority and observable events.

Until that increment exists, the Compose profile can show readiness, plans,
receipts and worker activity events, but it must not claim to provide complete
autonomous code patch delivery.

## Security impact

New exposed local ports bind to `127.0.0.1` only. The gateway remains inert.
Coordination remains local-preview scoped. JetStream is a local shared runtime
for preview streams and projections.

Residual risks are local resource use, stale Docker volumes and confusion
between “runtime/UI is up” and “workers can produce patches.” The UI and docs
must state that real worker execution is still pending.

## Qualification

- Compose config renders successfully.
- Control Plane image contains the compose runtime check and project policy.
- Static tests assert local-only ports and the worker execution limitation.
- Existing typecheck, runtime, supply-chain and build tests remain green.

## Rollback

Remove `compose.suite.yaml`, the compose runtime check script and this RFC. Stop
and remove local state with:

```bash
docker compose -f compose.suite.yaml down --volumes --remove-orphans
```
