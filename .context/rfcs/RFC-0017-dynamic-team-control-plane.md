# RFC-0017 — Dynamic MCP team control plane

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-15
- Accepted: 2026-08-15
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/127
- Depends on: RFC-0012 through RFC-0016; Coordination RFC-0030

## Decision

Add a persistent local team supervisor controlled through MCP and CLI clients.
A human uses a normal Codex or Copilot session as manager, provides a goal, and
the manager creates role-based Codex/Copilot workers without the human launching
each process. CLI is a secondary interface over the same control API.

The initial MCP contract contains `team.create`, `team.status`, `team.stop`,
`agent.spawn`, `agent.status` and `task.assign`. Team and agent identifiers are
server generated. Agent records include runtime, role, parent, task, workspace,
state and Coordination identity.

## Hierarchical delegation

An agent may create children only when its record carries delegated spawn
authority. Every child references one parent and inherits bounded workspace,
runtime profile, maximum depth, remaining agent count and lifetime. Delegation
cannot widen those bounds. The initial local profile defaults to depth three and
16 workers per team.

## Runtime

The supervisor outlives the initiating MCP session. It persists only bounded
public control state under `.yukh/`, starts fixed Codex/Copilot executables
without a shell wrapper, supervises exit/timeout, and records lifecycle events
through the worker's distinct Coordination identity. Closing the manager chat
does not stop the team.

Natural-language planning remains the manager model's responsibility. The
control plane validates and executes explicit structured requests; it does not
silently infer authority from transcript text.

## Observability

Watcher and status output show team, role, parent, task, runtime and lifecycle.
Messages remain in the verified Coordination transcript. Process output is
bounded and redacted; credentials and private reasoning are never persisted.

## Security impact

The project owner temporarily authorized an unrestricted local Copilot worker
profile for qualification. That profile is high trust and not production safe.
Dynamic spawning additionally introduces process and resource exhaustion risks,
bounded by server-owned depth, count, lifetime and executable configuration.

## Qualification

The vertical test creates a manager, backend and frontend workers, allows one
worker to create a test child, verifies distinct Coordination identities and
parentage, then stops the team without orphan processes.

## Rollback

Stop the supervisor and remove its bounded public state after process shutdown.
The existing two-agent conversation commands remain available during migration.
