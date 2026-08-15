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

For the owner-approved temporary local development profile, Copilot runs with
`--allow-all`: all tools, filesystem paths and URLs are available. This is an
explicitly accepted high-trust qualification profile, not a production default.
Coordination is the communication and handoff plane, not the only tool the agent
may use.

## Security impact

This profile lets Copilot execute arbitrary commands, access arbitrary paths and
URLs, and use every configured tool. It is suitable only for the owner's
explicitly trusted local qualification session. The operator reviews all
changes before integration. Transcript content can drive privileged activity
under this temporary profile and must be treated accordingly.

## Qualification

Tests cover compact and full bodies, answer linkage, duplicate join filtering,
argument rejection, and the exact fixed Copilot permission arguments.

## Rollback

Restore the restricted tool flags and full default rendering. Existing files
and transcript records need no migration.
