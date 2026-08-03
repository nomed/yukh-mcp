# Inert runtime skeleton

Issue #6 introduces the smallest production-shaped Yukh MCP process without
operational authority. It uses the official modular MCP TypeScript SDK v2 and a
stateless Streamable HTTP endpoint at `/mcp`.

The runtime deliberately registers empty `tools`, `resources`, and `prompts`
capabilities. Initialization and discovery work, but no handler can inspect or
change a target. There is no authentication adapter, authorization evaluator,
provider registry, credential loader, approval service, audit store, task API,
resumability, or mutation path.

## HTTP surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | `GET` | process liveness only |
| `/readyz` | `GET` | listener and inert MCP handler readiness |
| `/mcp` | `POST` | stateless MCP initialization and empty discovery |

Other routes return a bounded `404`; non-POST MCP requests return `405`. The
runtime does not open a long-lived notification stream in this phase.

The listener defaults to `127.0.0.1:3000`. Binding to all interfaces requires
an explicit host allowlist. Host validation protects the MCP route against DNS
rebinding; browser requests with an `Origin` header are denied unless that exact
origin is configured. MCP bodies are bounded before SDK parsing.

## Configuration

| Variable | Default | Bound |
| --- | --- | --- |
| `YUKH_HOST` | `127.0.0.1` | loopback or explicit wildcard enum |
| `YUKH_PORT` | `3000` | `0..65535`; zero is test-only ephemeral binding |
| `YUKH_ALLOWED_HOSTS` | `127.0.0.1,localhost` | 1–32 hostnames; required for wildcard bind |
| `YUKH_ALLOWED_ORIGINS` | empty | 0–32 exact URLs |
| `YUKH_MAX_BODY_BYTES` | `65536` | 1 KiB–1 MiB |
| `YUKH_SHUTDOWN_TIMEOUT_MS` | `5000` | 100 ms–30 s |

Configuration errors expose field names, never submitted values. Environment
variables outside this registry are ignored and cannot register capabilities.

## Logging

Runtime logs are closed JSON records containing timestamp, registered event,
level, server-created correlation reference, bounded HTTP status, and an
allowlisted code. Request bodies, headers, URLs, host/origin values, exception
messages, stack traces, client identity, and MCP payloads are excluded.

These logs are operational diagnostics, not RFC-0004 protected audit evidence.
No audit durability or integrity claim is made.

For local commands, use [Run the inert gateway](../how-to/run-inert-gateway.md).

The base-image tag is version-pinned but not digest-pinned. Image provenance,
digest selection, SBOM, signing, and release qualification remain governed by
issue #10.

## Compatibility

The server uses `createMcpHandler` from `@modelcontextprotocol/server` 2.0.0
with its stateless compatibility mode. New protocol features remain disabled
until separately reviewed. The implementation follows the
[official MCP TypeScript server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md).
