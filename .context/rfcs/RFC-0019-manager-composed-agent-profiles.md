# RFC-0019 — Manager-composed agent profiles

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-15
- Accepted: 2026-08-15
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/131
- Supersedes: RFC-0018 role catalog decision
- Depends on: RFC-0017

## Decision

The manager composes professional agent profiles for the current goal instead
of choosing from a hardcoded role catalog. A profile contains a bounded title,
mission, runtime, concrete allowlisted model, skill identifiers, operating
instructions and delegation flag. The manager may compose leads, developers,
product roles, reviewers or other specialists as the work requires.

`agent.engage` validates, persists and launches the composed profile. Fixed
roles may exist only as optional client-side examples; the control plane has no
closed profession list. Runtime model and skill allowlists remain operator
configuration and cannot be widened by manager text or child delegation.

## Manager profile

The team creator is recorded as a manager profile with its own title, runtime,
mission and authority bounds. A manager may create leads; a lead with explicit
delegation may compose bounded children inside the same team. Every child
retains parent identity and inherited team limits.

## Observability

Team-control writes closed lifecycle facts for team creation, profile
engagement, task assignment, worker start, terminal state and stop. The viewer
renders role, task summary, state, failure and log path. These facts describe
observable control actions and results, never private model reasoning.

Coordination remains the verified agent message channel. Team lifecycle facts
make manager actions visible even before an agent joins Coordination or when a
join fails. A worker that cannot establish required Coordination must report a
clear degraded or failed state rather than silently appearing collaborative.

## Qualification

Compose two previously unknown role titles, select different allowlisted
models and skills, launch them, and verify the viewer shows manager engagement,
task, start, Coordination state, completion and log. Deny an unknown model,
missing skill, unbounded instructions and unauthorized child composition.

## Rollback

Disable `agent.engage` and retain explicit `agent.spawn`. Persisted composed
profiles and lifecycle facts remain readable as public control evidence.
