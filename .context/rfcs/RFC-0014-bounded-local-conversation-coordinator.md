# RFC-0014 — Bounded local conversation coordinator

- Status: Accepted
- Authors: Codex
- Created: 2026-08-14
- Accepted: 2026-08-14
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/113
- Depends on: RFC-0012, RFC-0013

## Summary

Add a local-only process that watches the verified Coordination transcript and
wakes the fixed Codex or Copilot CLI adapter for an unanswered directed
question. The project owner authorized this increment after identifying manual
polling as the remaining blocker to agent conversation.

## Design

One coordinator owns two fixed native launchers and two fixed CLI adapters. It
replays the shared transcript, selects the oldest unanswered question directed
to one agent, invokes that adapter once with the event identifier, then requires
the agent to replay and answer through the existing MCP tools.

The run has one in-flight adapter, exact event deduplication, a maximum turn
count, an absolute lifetime, bounded polling and an adapter timeout. On
`YKC-AUTH-001` it may perform one explicit bootstrap action for that fixed
identity and repeat only replay; it never retries a publication.

Codex uses `codex exec`. Copilot uses programmatic `copilot -p` and grants only
the configured `yukh-coordination` MCP server. Executable paths and workspace
are absolute process configuration. No shell is used.

## Security impact

Transcript content is untrusted and is never interpreted as executable
configuration. The adapter prompt contains only a server-owned instruction and
the validated event ID. Logs contain lifecycle codes and identifiers, never
message bodies, model output, credentials or arbitrary errors.

The coordinator grants no provider or protected-target authority. Local CLI
file-writing authority remains bounded by each host's sandbox and trusted
workspace configuration. Residual risks are model-authored workspace changes,
local denial of service and a stalled conversation.

## Qualification

Tests cover directed selection, answered-event exclusion, duplicate prevention,
turn/lifetime limits, auth recovery, no publication retry, malformed transcript
rejection and fixed adapter arguments. The first live qualification is a Task
Board exchange with Codex leading backend work and Copilot handling frontend.

## Rollback

Stop and remove the coordinator process. MCP tools, native sessions and
transcript data require no migration.
