# RFC-0015 — Local conversation observer

- Status: Accepted
- Authors: Codex
- Created: 2026-08-14
- Accepted: 2026-08-14
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/115
- Depends on: RFC-0014

## Summary

Add a read-only terminal observer for local Coordination conversations and make
coordinator lifecycle output operator-readable. This is the minimum interface
needed for the project owner to understand who is working and what agents say.

## Design

`yukh conversation watch` follows the verified transcript, prints new records
once, groups them by actor and event type, and shows message bodies on the local
operator terminal. Receipt identifiers are hidden unless `--verbose` is used.

Coordinator output changes from repeated idle ticks to closed lifecycle events:
`agent_started`, `answer_verified`, `agent_completed_without_answer`,
`agent_failed`, and `conversation_complete`. An adapter exit is not success
until replay proves an answer bound to the selected question.

## Security impact

The observer is local and read-only. Transcript bodies are intentionally shown
to the operator but are not copied into coordinator lifecycle logs. Credentials,
reasoning, raw stderr and unknown fields are never printed. Malformed transcript
records fail closed. Matrix, IRC, remote listeners and control commands remain
out of scope.

## Qualification

Tests cover rendering, incremental sequence handling, verbose receipt display,
malformed records, lifecycle transitions and answer verification.

## Rollback

Remove the observer entrypoint and restore the previous coordinator output. No
transcript or credential migration is required.
