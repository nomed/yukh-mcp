---
name: yukh-agent-workflow
description: Use when operating Yukh manager, worker, or subagent teams; assigning roles, models, skills, budgets, receipts, and evidence; or developing the Yukh suite with Yukh itself.
---

# Yukh Agent Workflow

Use this skill when a task asks Codex to operate through Yukh, create or guide
Yukh managers/workers/subagents, or develop the Yukh suite with Yukh itself.

## Core rule

Yukh gives agents capability, not custody. A manager may compose bounded work,
but repository mutation and external publication remain explicit, reviewable
handoffs.

## Manager behavior

Before engaging a worker, the manager must define:

- role and responsibility;
- runtime and model from the available allowlist;
- required skills, omitting unavailable skills rather than inventing them;
- token budget, command limit, runtime timeout and tool mode;
- exact task scope and acceptance evidence;
- whether the worker may spawn subagents.

Prefer the smallest useful team. Do not create agents merely to mirror an org
chart. If one bounded worker is enough, use one worker.

## Worker behavior

A worker must:

- stay inside the assigned scope;
- use only authorized tools and context;
- keep output compact;
- report token usage when available;
- report log path, Coordination receipt, or other evidence;
- fail closed when required receipts, budget accounting, or permissions are
  missing.

Workers do not publish independently unless explicitly assigned the publishing
role.

## Subagent behavior

Subagents inherit the parent task boundary. They return bounded evidence to the
parent:

- files changed or patch summary;
- validation command and result;
- token usage if available;
- log path or Coordination receipt;
- explicit gaps.

A parent worker or manager decides whether subagent output becomes part of a
commit. Subagents may be credited only for work they actually produced.

## Self-development baseline

When using Yukh on the Yukh suite itself, prefer this order:

1. read-only baseline probe;
2. bounded diff classification;
3. one micro implementation or documentation increment;
4. focused validation;
5. GitHub-compatible publication.

Never start with a broad implementation team if the repo state, budget, model
catalog, runtime, or Coordination health is unknown.

## Token discipline

Preflight before launch when possible. If the CLI runtime has a measured token
floor, do not launch below that floor. Prefer SDK/lean runtimes for cheap
workers once qualified. Token overrun is a hard failure, not a warning.

## Authorship evidence

Use truthful attribution:

- agent generated final file changes: agent may be commit `Author`;
- manager/operator applied an unchanged agent patch: agent may be `Author`,
  integrator is `Committer`;
- agent only verified: use `Verified-by`, not `Author`.

Recommended evidence trailers:

```text
Generated-by: yukh <agent_id>
Verified-by: yukh <agent_id>
Team: <team_id>
Coordination-agent: <coordination_agent>
Token-observed: <observed>/<budget>
Log: <workspace-relative-log-path>
```

Do not claim an agent authored a change it only validated.

