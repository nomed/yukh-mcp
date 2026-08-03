# Session — mutation lifecycle RFC

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/4
- Branch: `agent/issue-4-lifecycle-rfc`
- Status: RFC accepted by project owner; merge pending

## Outcome

Drafted RFC-0003 for immutable plans, exact plan-bound approval, fresh apply
authorization, stale-precondition invalidation, durable idempotency reservation,
ambiguous completion, verification-gated success, partial effects, and rollback
as a new authorized lifecycle. Added the corresponding threat-model delta.

## Audit dependency resolution

Issue #4 depended on issue #9. Accepted RFC-0004 now supplies the event registry,
ordering, integrity verification, redaction, retention, export, and phase-aware
sink-failure semantics. RFC-0003 has been reconciled to that contract and remains
Proposed pending explicit project-owner acceptance.

## Boundary

No lifecycle schemas, runtime, approval adapter, identity integration,
provider, credential, durable store, verifier, audit sink, or deployment was
implemented.
