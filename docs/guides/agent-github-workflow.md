---
title: Agent GitHub workflow
description: How Yukh managers, workers and subagents should publish repository work.
---

# Agent GitHub workflow

Yukh agents may produce work, but GitHub publication remains an explicit
reviewable handoff.

## Skills and tools

The Yukh plugin carries the Yukh operating skills:

- `yukh-agent-workflow` for manager, worker, subagent, budget and evidence
  behavior;
- `yukh-github-publication` for commit attribution and GitHub-compatible
  publication.

These skills are not a hard dependency on the GitHub plugin. When the GitHub
plugin or GitHub workflow skill is available, use it as the authoritative
publication workflow. When it is unavailable, use the Yukh safe local fallback
and stop before unverified external GitHub mutation.

## Roles

- A **worker** edits files only inside its assigned scope.
- A **subagent** follows the same rules as a worker, with a parent worker as
  its delegating authority.
- A **manager** classifies scope, budget, model, skills and acceptance evidence.
- An **operator or publishing manager** commits, pushes and opens the pull
  request after checking the diff.

## Commit attribution

Use truthful authorship:

- If an agent directly generated the final file changes, set commit `Author` to
  that agent.
- If a manager or operator applied an agent's patch without changing it, keep
  the agent as `Author` and the integrator as `Committer`.
- If an agent only reviewed or verified work, keep the real implementer as
  `Author` and add a `Verified-by` trailer for the agent.

Recommended trailers:

```text
Generated-by: yukh <agent_id>
Verified-by: yukh <agent_id>
Team: <team_id>
Coordination-agent: <coordination_agent>
Token-observed: <observed>/<budget>
Log: <workspace-relative-log-path>
```

Do not claim an agent authored a change it only validated.

## Publish flow

Follow the GitHub publish workflow:

1. Inspect `git status -sb` and the exact diff.
2. If unrelated changes are present, stage explicit paths only.
3. Create an `agent/<description>` branch when starting from `main`.
4. Commit with a terse subject and the trailers above.
5. Run the smallest relevant validation already justified by the task.
6. Push the branch.
7. Open a draft pull request by default.

The pull request body should state what changed, why, validation performed,
the agent/team evidence and anything not yet verified.

## Subagent behavior

Subagents do not publish independently. They return bounded evidence to their
parent:

- files changed or patch summary;
- validation command and result;
- token usage if available;
- log path or Coordination receipt;
- explicit gaps.

The parent worker or manager decides whether the result becomes part of a
commit. A subagent's ID may appear in `Generated-by` only for the files it
actually produced.

## Fail closed

Do not commit or push when:

- the diff contains unrelated files;
- author attribution is unclear;
- token accounting is missing for a budgeted worker;
- required receipts are missing;
- validation was skipped without an explicit reason.
