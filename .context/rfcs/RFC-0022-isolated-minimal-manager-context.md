# RFC-0022 — Isolated minimal manager context

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-16
- Accepted: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/143
- Depends on: RFC-0020 and RFC-0021

## Decision

Accounted Codex runtimes start with `--ignore-user-config`. Authentication is
retained by the CLI, while user-configured MCP servers, plugins and unrelated
instructions are excluded. Yukh injects only its reviewed runtime configuration.
Failure to start the isolated profile remains a terminal runtime failure.

The team-control MCP exposes only tools required by the current agent record.
A pure planning manager receives no model-facing MCP server; `manager.start`
and terminal state are verified by the controller. A manager that explicitly
requires `team.status` receives only that tool and no Coordination MCP.
Managers that must engage or await workers
receive those explicitly required tools and Coordination. Workers receive a
bounded tool set derived from delegation authority.

Accounted `team.status` returns a compact projection containing team bounds,
token totals, agent identifiers, roles, states, budgets and completion outcomes,
plus the exact new receipt. It excludes goals, tasks, missions, instructions,
skills, Coordination identities, completion summaries and prior receipts. The
operator and watcher retain the full persistent status.

## Accounting

Optimization never changes token semantics. Total remains input plus output;
cached input remains visible within input. A real bounded planning turn must be
measured after implementation. Raising a budget is not accepted as evidence of
reduced consumption.

## Qualification

- prove the Codex invocation contains `--ignore-user-config`;
- prove a pure planning manager receives no MCP and a status-only manager receives only `team.status`;
- prove accounted status excludes prompt-derived fields;
- keep external full status compatible;
- run one real tool-free planning turn and target fewer than 20,000 total tokens.

The real Codex qualification completed at 14,382 total tokens: 13,735 input,
9,984 of that cached, and 647 output. The equivalent status-tool profiles used
39,219 and 43,289 total tokens. Pure planning therefore remains tool-free;
operational tool turns are separately budgeted and receipt-backed.

## Rollback

Disable dynamic manager launch. Do not restore inherited user configuration or
unbounded model-facing tool surfaces as a compatibility fallback.
