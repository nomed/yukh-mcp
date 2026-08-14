# RFC-0013 — Explicit local Coordination bootstrap

- Status: Proposed
- Authors: Codex
- Created: 2026-08-14
- Governing issue: https://github.com/nomed/yukh-mcp/issues/111
- Depends on: RFC-0012, https://github.com/nomed/yukh-coordination/issues/222
- Amends: RFC-0012

## Summary

Add one preview-only MCP tool, `coordination.bootstrap`, so the fixed Codex or
Copilot identity can explicitly obtain a fresh short-lived Coordination
session after expiry. The action is never automatic and never retries another
operation.

## Motivation

RFC-0012 exposes session operations but not the prerequisite bootstrap.
Sessions expire after ten minutes by design. A host that receives
`YKC-AUTH-001` cannot recover using only MCP and currently requires a person to
run the native launcher. This prevents a sustained Codex–Copilot exercise.

## Design

The preview server exposes six tools, adding this fixed mapping:

| MCP tool | Coordination command | Effect |
| --- | --- | --- |
| `coordination.bootstrap` | `session bootstrap` | replace an expired or create an absent short-lived session |

The tool accepts no input. Agent identity, launcher, configuration, custody
profile, descriptors and endpoints remain process-owned. The launcher keeps
all tokens and keys outside MCP input, output and logs.

The native client must:

- reject bootstrap while the stored session is live;
- replace an expired session using the exact stored revision;
- obtain fresh external authority for every explicit attempt;
- retain the existing 15-minute maximum lifetime;
- return only the closed result or sanitized `YKC-*` error.

The bridge must not invoke bootstrap after an auth failure, replay the failed
operation, poll expiry or run in the background. The model or user chooses the
bootstrap tool as a separate observable action.

## Security impact

The new model-selected action reaches credential custody but cannot select or
observe credential material. Main threats are repeated issuance, live-session
replacement, command substitution and presenting bootstrap as authorization.
Controls are the no-input schema, fixed command registry, native live-session
refusal, exact-revision CAS, bounded execution and unchanged separation between
Coordination identity and capability authority.

Residual risks are local denial of service through repeated refused calls and
availability loss when the native authority is unavailable. The tool remains
local-preview-only and grants no provider or protected-target authority.

## Qualification

- discovery lists exactly the six preview tools while the ordinary gateway
  remains empty;
- fake-launcher tests prove the exact no-input command mapping;
- unknown command, caller-selected profile and credential-shaped input fail;
- live-session refusal and expired-session replacement remain qualified by the
  native client;
- one Mac test expires or invalidates a session, explicitly bootstraps through
  MCP, then completes join and replay for both agents.

## Rollback

Remove the bootstrap registration and command allowlist entry. Existing native
sessions and transcript data require no migration.

## Alternatives

Automatic renewal was rejected because it hides a credential mutation and
could replay an operation after an ambiguous result. Longer sessions were
rejected because they weaken the accepted short-lived preview identity rather
than fixing recovery.

## Acceptance

Implementation is forbidden until the project owner explicitly accepts this
RFC and the threat-model impact.
