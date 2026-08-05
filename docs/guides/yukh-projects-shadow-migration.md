# Yukh Projects shadow migration

The `Yukh Projects shadow reconciliation` workflow audits one Project 5 issue
without mutation. It pins the immutable `yukh-projects` v1.5.1 commit
`d58837397bc5856923e0e742458be34d8e5a27d6` and selects the bounded
`legacy-shadow` adapter. It accepts no apply mode, approval artifact, or write
credential.

Run it manually with the exact issue number selected for comparison. Review the
bounded step summary and the one-day redacted report artifact against the last
verified legacy dry-run. Explain every operation or diagnostic difference in
the migration pull request before requesting controlled apply.

The distinct `Area` contract remains separate from `Component`. The current
policy expresses the logical Issue Type target for `kind`; the provider is
selected from observed repository ownership. Because `nomed/yukh-mcp` is
user-owned, v1.5.1 must plan the Project `Work Type` fallback. The shadow emits
the exact plan ID and ordered operation count used by controlled planning while
preserving human-owned `Status` and the existing `Component` value.

Do not trigger a fresh legacy backlog audit merely to populate comparison
evidence. Reuse the last verified legacy result unless a reviewer identifies a
specific missing observation. This avoids returning development automation to
the legacy GraphQL-heavy path.

The existing legacy reconciliation and bootstrap workflows remain unchanged as
the rollback surface. Their presence does not authorize apply. Removing them,
running controlled apply, or changing Project state requires a later explicit
approval under issue #27.
