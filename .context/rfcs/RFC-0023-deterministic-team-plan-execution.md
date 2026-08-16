# RFC-0023 — Deterministic team plan execution

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-16
- Accepted: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/145
- Depends on: RFC-0020, RFC-0021 and RFC-0022

## Decision

A planning manager may declare the `team-plan-v1` output contract. It runs once,
without model-facing tools, and must emit a closed structured plan containing
bounded worker profiles and one separately budgeted synthesis profile. The
accounted wrapper validates the plan, binds it to the manager and team, computes
its SHA-256 digest and persists it as proposed state. Text that merely resembles
a plan is not executable authority.

The external controller executes the proposed plan by presenting its exact
digest. Before creating or launching any worker, Yukh verifies that the manager
completed successfully, the plan is still proposed, every model and skill is
allowlisted, the team has enough agent slots and the aggregate manager, worker
and synthesis allocation fits the team budget. Validation failure has no worker
side effects.

After reservation, a deterministic executor launches the workers, waits once
for each terminal completion and records execution receipts. It does not invoke
the planning manager again. If every worker succeeds, it launches exactly one
tool-free synthesis agent with the bounded public completion artifacts as its
input. Synthesis has its own allocation and exact runtime usage. Worker failure,
timeout or oversized synthesis input stops the plan without inventing a result.

## Approval and replay

The public execution request is the explicit approval boundary for this
non-destructive local preview operation. It must contain the persisted plan
digest. A changed, substituted or stale digest fails closed. A plan may execute
only once; repeated execution requests return its existing terminal or running
state and never duplicate workers.

## Accounting and privacy

The team allocation reserves planning, all workers and synthesis. Observed
tokens remain the exact runtime totals defined by RFC-0020. Executor control
work consumes no model tokens. Only bounded public-safe completion summaries
enter synthesis; prompts, private reasoning and raw provider streams do not.

## Qualification

- reject unknown plan fields and malformed profiles;
- reject stale digests, unavailable profiles, insufficient agent slots and
  aggregate over-allocation before creating a worker;
- prove execution launches and awaits workers without another manager turn;
- invoke synthesis only after all workers succeed and expose its exact usage;
- prove replay does not duplicate workers;
- expose plan state, worker identities, synthesis identity and receipts.

## Rollback

Disable plan execution and preserve proposed plans, agents, usage and receipts
for inspection. Do not fall back to manager-driven engage/await loops for a
`team-plan-v1` manager.
