# Yukh Projects shadow migration

The `Yukh Projects shadow reconciliation` workflow audits one Project 5 issue
without mutation. It pins the immutable `yukh-projects` v1.6.1 commit
`e3285c6994edd8fad1666da6ca48386522c9e90f` and selects the bounded
`legacy-shadow` adapter. It accepts no apply mode, approval artifact, or write
credential.

Run it manually with the exact issue number selected for comparison. Review the
bounded step summary and the one-day redacted report artifact against the last
verified legacy dry-run. Explain every operation or diagnostic difference in
the migration pull request before requesting controlled apply.

The distinct `Area` contract remains separate from `Component`. The current
policy targets native Issue Type for `kind`; `project_field: Work Type` remains
only the required declarative fallback for a user-owned repository. GitHub
reports `nomed/yukh-mcp` as user-owned, so v1.6.1 must report the same Project
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

The accepted protected apply design is tracked by issue #70 and RFC-0007.
`nomed/yukh-projects#131` is resolved in v1.6.1, but controlled apply still
requires a fresh shadow, an independently approved exact plan, and separately
gated operational dependencies. The repository contains only a permanently
skipped contract shape with no steps, endpoint, materializer request,
credentials, outputs, or producer invocation. No executable apply workflow or
runtime authority may be added by design acceptance alone.
