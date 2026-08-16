# RFC-0021 — Budgeted root manager and action receipts

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-16
- Accepted: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/139
- Supersedes the external-manager portion of: RFC-0020

## Decision

A model session outside Yukh cannot be the authoritative team manager because
its runtime usage and tool actions are not enforceable team evidence. The
public `manager.start` operation creates a team, reserves a root manager budget
and then launches that manager through the same accounted wrapper as
workers. The root manager is persistent agent state at depth zero. Its token
allocation consumes the team budget before any worker allocation.

The older `team.create` operation remains available only for readable legacy
logical-team state. An unaccounted external caller cannot use `agent.engage` or
`agent.spawn`; both fail with `manager_runtime_required`. Existing stored teams
remain readable and stoppable.

## Action evidence

`manager.start` accepts a closed set of required actions: `team.status`,
`agent.engage` and `agent.await`. Successful tool execution emits a bounded,
server-authored receipt containing only opaque team, actor, subject and receipt
identifiers, the action and its successful outcome. Free text, prompts, model
reasoning, tool input and tool output are excluded.

The wrapper checks persistent receipts before releasing a successful manager
completion. A plausible final response without every required receipt becomes
`required_action_missing`. The store independently rejects a forged successful
completion with missing receipts. At most 256 receipts are retained per team.

## Accounting and limits

Manager and worker usage use the same exact runtime evidence from RFC-0020.
Status and the observer expose total, input, cached-input, output and
reasoning-output counts. Cached input remains part of input and is never hidden
from total context consumption. Runtime reporting is still post-turn; the
declared budget does not claim preemptive mid-turn interruption.

Prompts instruct managers to keep inspection and tool output bounded, but this
is not a security control. A manager overrun is persisted and fails exactly as
a worker overrun. No child starts unless its manager is a registered caller and
the aggregate reservation, model and skill checks succeed.

## Qualification

- reserve manager tokens before allowing worker allocation;
- reject manager allocation above the team budget;
- deny external unaccounted engagement;
- reject successful completion when a required receipt is absent;
- persist successful action receipts and show them in team status and observer;
- show exact token categories without double-counting cached input;
- qualify `manager.start` through the MCP transport before a real model retry.

## Rollback

Disable `manager.start` and all worker engagement. Preserve team, manager,
usage, completion and receipt records for inspection. Restoring unaccounted
external managers or accepting textual action claims is forbidden.
