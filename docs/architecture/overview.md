# Architecture

Yukh MCP keeps client intent, policy, provider authority, and evidence in
separate boundaries.

![Yukh MCP boundaries: client intent enters the gateway, policy gates a typed provider operation, and verification produces evidence.](../assets/architecture-boundaries.svg)

## Boundaries

- **Client:** proposes intent; never supplies execution authority.
- **Gateway:** validates the capability and enforces identity and policy.
- **Provider:** holds bounded target authority; credentials stay here.
- **Verifier:** evaluates declared postconditions independently from execution.
- **Evidence:** records decisions and outcomes in closed, redacted structures.

Mutations add a bound plan and approval between policy and provider invocation.
The current public demo is read-only.

## Inert coordination consumer port

The Coordination consumer port supports nonce consumption and fenced leases
required by accepted mutation lifecycle contracts. It treats every response as
untrusted and stops on invalid data, stale state, timeout, or dependency failure.

The reviewed HTTPS adapter is qualified only against synthetic loopback TLS. It
is not wired into the gateway and has no real endpoint or credential. Nonces
and lease handles never enter logs, evidence, errors, model context, or the
repository.

RFC-0005 governs the adapter. RFC-0006 and issue #50 govern the first
disabled-by-default staging qualification. They authorize no production
endpoint, gateway wiring, provider execution, mutation, or live apply.
