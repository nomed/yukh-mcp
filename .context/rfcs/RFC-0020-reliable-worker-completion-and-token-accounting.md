# RFC-0020 — Reliable worker completion and token accounting

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-16
- Accepted: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/137
- Depends on: RFC-0017 and RFC-0019

## Decision

Every dynamic team and worker carries an explicit integer token budget. Worker
allocation cannot exceed the team budget. Team status and the conversation
viewer expose allocated and observed totals, remaining budget, pending
accounting and overruns without retaining prompts or private reasoning.

Runtime accounting is evidence, not estimation. Codex workers run with their
structured JSON stream and persist the CLI-reported input, cached input,
output and reasoning-output counts. Total budget consumption is reported input
plus output. A runtime that does not expose trustworthy token counts fails
closed with `token_accounting_unavailable`; credits or elapsed time are not
mislabelled as tokens. The current Copilot CLI therefore remains unavailable
to token-strict team execution even though its separate credit metadata may be
observable.

The runtime reports token use only when a turn completes. The initial boundary
is consequently a declared soft limit with post-turn fail-closed enforcement,
not a claim of exact mid-generation interruption. An overrun is persisted as
`token_budget_exceeded` and the worker fails. Future preemptive enforcement
requires a separately reviewed runtime control that reports monotonic usage
during execution.

## Reliable handoff

Every worker has both its launcher name (`agent-*`) and canonical Coordination
participant (`agent:*`) in persistent state. Callers use the returned
participant exactly; they never derive or prefix it.

Successful workers must produce one bounded public-safe final summary. The
wrapper persists it as a completion artifact together with the terminal
outcome and usage. `agent.await` provides bounded waiting for terminal state so
a manager can consume child results without polling or completing early.
Missing completion, unavailable accounting, non-zero exit and token overrun
are distinct terminal failures. Expected engagement denials return stable
public-safe codes rather than opaque tool failures.

## Security and privacy

Completion summaries are limited to 4096 UTF-8 bytes and remain public control
evidence. Raw prompts, private reasoning, credentials and provider payloads are
not copied into team state. Runtime JSON remains in the existing private local
worker log and must not be presented as a public transcript.

Budgets constrain resource allocation but grant no model, skill, filesystem,
network, mutation or delegation authority. Child budgets consume the same
team allocation and cannot widen parent or team bounds.

Pre-RFC team records remain readable with an effective zero budget so the
viewer can explain them. They cannot engage another worker and must be stopped
and explicitly recreated; no budget is inferred during migration.

## Qualification

- reject aggregate worker allocations above the team budget;
- extract exact Codex JSON usage and reject malformed counts;
- refuse to invent token counts from Copilot credit metadata;
- persist one bounded completion and return it through `agent.await`;
- render team and worker budgets, accounting source and completion outcome;
- prove canonical participant identifiers do not acquire a second prefix;
- exercise timeout, missing completion, unavailable accounting and overrun.

## Rollback

Disable new team creation and worker engagement. Existing records remain
readable. Removing accounting or completion fields while dynamic execution is
enabled is forbidden because it would restore silent resource use and lost
handoffs.
