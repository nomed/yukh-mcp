# Yukh Projects shadow migration

The `Yukh Projects shadow reconciliation` workflow audits one Project 5 issue
without mutation. It pins the immutable `yukh-projects` v1.7.0 commit
`71784218366805922e5a12903eef9073f715f59f` and selects the bounded
`legacy-shadow` adapter. It accepts no apply mode, approval artifact, or write
credential.

Run it manually with the exact issue number selected for comparison. Review the
bounded step summary and the one-day redacted report artifact against the last
verified legacy dry-run. Explain every operation or diagnostic difference in
the migration pull request before requesting controlled apply.

The distinct `Area` contract remains separate from `Component`. The current
policy targets native Issue Type for `kind`; `project_field: Work Type` remains
only the required declarative fallback for a user-owned repository. GitHub
reports `nomed/yukh-mcp` as user-owned, so v1.7.0 must report the same Project
`Work Type` fallback as controlled planning. A fresh shadow must prove this
parity while preserving human-owned `Status` and the existing `Component`
value.

If deferral occurs, the workflow terminates and exposes only the redacted
receipt supported by the pinned producer. This Actions job is not a durable
coordinator and must not sleep, poll, self-dispatch, or retain execution
ownership. A separately governed host is required before resumable apply.

Do not trigger a fresh legacy backlog audit merely to populate comparison
evidence. Reuse the last verified legacy result unless a reviewer identifies a
specific missing observation. This avoids returning development automation to
the legacy GraphQL-heavy path.

The existing legacy reconciliation and bootstrap workflows remain unchanged as
the rollback surface. Their presence does not authorize apply. Removing them,
running controlled apply, or changing Project state requires a later explicit
approval under issue #27.

The protected apply boundary is tracked by issue #70, RFC-0007, and RFC-0008.
RFC-0008 permanently supersedes RFC-0007 only for credential delivery:
controlled apply must use a GitHub Actions secret named `YUKH_PROJECTS_WRITE_TOKEN`, configured
manually outside repository content. `YUKH_PROJECTS_WRITE_TOKEN` must never be committed,
printed, added to outputs, artifacts, caches, step summaries, or logs. The
former materializer and GitHub OIDC delivery model is not permitted.

`nomed/yukh-projects#131` is resolved in v1.7.0, but controlled apply still
requires a fresh shadow, an independently approved exact plan, and separately
gated operational dependencies. The repository contains only the
`future-controlled-apply` contract job. Its hard-coded false condition is
permanent: it has no steps, outputs, or producer invocation. The job fixes the
repository, Project 5, issue #27, policy path, mode
`legacy-single-token-apply-v1`, environment, producer pin, concurrency group,
ten-minute limit, and first-attempt-only constraint for a future reviewed
implementation. It has no OIDC permission.

An independently issued approval for a freshly recreated exact plan and a
reviewed host-capsule/Coordination profile remain absent. Neither a dispatch,
an environment review, issue state, nor the presence of `YUKH_PROJECTS_WRITE_TOKEN` can replace
either control. The only `secrets.YUKH_PROJECTS_WRITE_TOKEN` expression is
job-local to `future-controlled-apply`; its permanent false condition prevents
the job, runner, and secret resolution. It is a reference only, not a configured
or exposed secret. The pinned shadow Action is a bounded dry-run interface;
although v1.7.0 defines the reviewed single-token mode for its separate apply
entrypoint, this source does not invoke it. A separate explicit authorization
and review must qualify an immutable apply interface and the approval and host
controls before any condition change or provider invocation can be added.
