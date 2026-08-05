# RFC-0009 — Yukh Projects write-token secret name

- Status: Accepted
- Created: 2026-08-05
- Accepted: 2026-08-05
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Supersedes: RFC-0008 credential-secret name only

## Decision

The fixed GitHub Actions secret for the Project 5 controlled-apply profile is
named `YUKH_PROJECTS_WRITE_TOKEN`.

It replaces the ambiguous `GH_TOKEN` name in RFC-0008. The token is configured
manually outside repository content, is never committed or printed, and is
passed only to a future reviewed fixed-scope producer invocation. This change
does not enable the inert workflow or authorize an apply.
