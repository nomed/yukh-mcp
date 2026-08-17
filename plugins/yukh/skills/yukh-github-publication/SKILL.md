---
name: yukh-github-publication
description: "Use when publishing Yukh-generated or Yukh-verified work to GitHub: commit attribution, branch creation, push, draft pull request, and GitHub workflow compatibility."
---

# Yukh GitHub Publication

Use this skill when Yukh-managed work needs to become a commit, branch, push or
pull request.

## Relationship to GitHub skills

This skill is GitHub-aware but not GitHub-dependent.

If a GitHub workflow skill or GitHub plugin tool is available, follow that
workflow for GitHub operations. In particular, respect the publish flow that
requires diff inspection, explicit staging, branch discipline, validation, push
and draft pull request by default.

If GitHub skills/tools are unavailable, use the safe local fallback below and
stop before unverified external GitHub mutation.

## Required publish flow

1. Inspect `git status -sb` and the exact diff.
2. If unrelated changes exist, stage explicit paths only.
3. If starting from `main` or the default branch, create `agent/<description>`.
4. Commit with a terse subject.
5. Add truthful Yukh evidence trailers.
6. Run the smallest relevant validation justified by the change.
7. Push with tracking only after scope is clear.
8. Open a draft pull request by default.

The pull request body must state:

- what changed;
- why it changed;
- validation performed;
- agent/team evidence;
- known gaps or skipped validation.

## Attribution

Set commit authorship by actual contribution:

- `Author`: the agent or person that produced the final file changes.
- `Committer`: the integrator that created the commit.
- `Verified-by`: any agent that only checked the result.

Never use an agent as `Author` when it only ran a read-only verification.

## Safe local fallback

When GitHub tools are not available:

- inspect and stage locally;
- create a local branch if needed;
- create the local commit only when attribution and scope are clear;
- do not push or open a pull request;
- report the exact command sequence the operator should run in a GitHub-capable
  environment.

## Stop conditions

Do not commit, push or open a PR when:

- the diff contains unrelated files;
- author attribution is unclear;
- token accounting is missing for a budgeted worker;
- required receipts are missing;
- validation was skipped without an explicit reason;
- GitHub repository or authentication state is ambiguous.
