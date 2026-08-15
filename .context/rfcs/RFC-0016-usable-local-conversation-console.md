# RFC-0016 — Usable local conversation console

- Status: Accepted
- Authors: Codex
- Created: 2026-08-15
- Accepted: 2026-08-15
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/117
- Depends on: RFC-0014, RFC-0015

## Summary

Make the local observer concise enough for continuous use and permit the fixed
Copilot adapter to create frontend files in the trusted conversation workspace.

## Design

The default observer shows a bounded preview of each message. `--full` displays
the complete bounded body, while `--verbose` adds event and receipt identifiers.
Repeated joins for the same participant are hidden. Answers show the question
identifier they bind.

The Copilot programmatic adapter receives only `read`, `write`, and the fixed
`yukh-coordination` MCP server. Its current working directory remains the exact
validated workspace. Shell, URL, unrestricted path and allow-all permissions
remain denied. Dependency installation and tests remain operator or future
fixed-verifier responsibilities.

## Security impact

Read and write access lets Copilot inspect and modify files inside the trusted
workspace. It cannot execute repository-authored scripts, fetch URLs or address
another MCP server. The operator reviews diffs before integration. Transcript
content remains untrusted and grants no additional authority.

## Qualification

Tests cover compact and full bodies, answer linkage, duplicate join filtering,
argument rejection, and the exact fixed Copilot permission arguments.

## Rollback

Remove the read/write flags and restore full default rendering. Existing files
and transcript records need no migration.
