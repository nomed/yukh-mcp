# Yukh Projects shadow migration

The `Yukh Projects shadow reconciliation` workflow audits one Project 5 issue
without mutation. It pins the immutable `yukh-projects` v1.3.3 commit
`e086e89395808377845567325b3a0fa73ef6e926` and accepts no apply mode, approval
artifact, or write credential.

Run it manually with the exact issue number selected for comparison. Review the
bounded step summary and the one-day redacted report artifact against the last
verified legacy dry-run. Explain every operation or diagnostic difference in
the migration pull request before requesting controlled apply.

Do not trigger a fresh legacy backlog audit merely to populate comparison
evidence. Reuse the last verified legacy result unless a reviewer identifies a
specific missing observation. This avoids returning development automation to
the legacy GraphQL-heavy path.

The existing legacy reconciliation and bootstrap workflows remain unchanged as
the rollback surface. Their presence does not authorize apply. Removing them,
running controlled apply, or changing Project state requires a later explicit
approval under issue #27.
