# RFC-0024 — Preemptive agent runtime bounds

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-16
- Accepted: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/149
- Depends on: RFC-0020, RFC-0022 and RFC-0023

## Evidence

The first real deterministic self-hosting execution proved that post-turn token
accounting is not an expense control. Planning completed at 14,717 of 20,000
tokens. One worker then reported 344,007 tokens against a 45,000 allocation in
one provider turn containing eleven command executions. Input was 340,832,
including 295,936 cached. The synthesizer never launched and the team was
stopped.

## Decision

Every new managed agent declares a server-validated maximum command count and
wall-clock runtime. The wrapper counts structured `command_execution` start
events and terminates the owned runtime process group immediately when a command
beyond the declared count starts. It also terminates the process group when the runtime
deadline expires. These are preemptive expense proxies; exact token accounting
remains the post-turn evidence defined by RFC-0020.

Deterministic plans also declare a model tool mode per agent: `none`,
`coordination`, or `team`. `none` exposes no Yukh MCP, `coordination` exposes only
Coordination, and `team` exposes the bounded team-control surface plus
Coordination. Synthesis must use `none`. Independent workers should use `none`;
communication or delegation is explicit plan data rather than an automatic
worker default.

The deterministic executor is restart-resumable. Re-execution of the same exact
digest continues reserved, running, or synthesizing state by inspecting
persistent agent states. It launches only defined agents, awaits already-running
ones, converges terminal worker failure to failed plan state, and never duplicates
a completed or running worker.

## Outcomes and observation

`command_budget_exceeded` and `runtime_deadline_exceeded` are distinct terminal
agent outcomes. Status and the conversation watcher expose command and deadline
bounds without retaining command text. A preemptively terminated runtime may not
have exact token usage because the provider reports only at turn completion; it
must never be reported as zero consumption.

## Qualification

- terminate on command N+1 start and exercise zero-command agents;
- terminate at the wall-clock deadline and kill the owned process group;
- prove tool modes produce exactly the intended MCP configuration;
- require closed bounds in structured plans and reject unknown or excessive
  values before worker creation;
- resume reserved, running and synthesizing plans without duplicate launch;
- converge a terminal failed worker to failed plan state without synthesis;
- do not perform another real model qualification until all tests and CI pass.

## Rollback

Disable dynamic model execution. Removing preemptive bounds while retaining
post-turn accounting is forbidden because the real qualification proved that it
can incur unbounded cost before detection.
