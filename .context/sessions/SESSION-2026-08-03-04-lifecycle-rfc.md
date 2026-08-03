# Session — mutation lifecycle RFC

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/4
- Branch: `agent/issue-4-lifecycle-rfc`
- Status: proposed RFC drafted; review PR pending

## Outcome

Drafted RFC-0003 for immutable plans, exact plan-bound approval, fresh apply
authorization, stale-precondition invalidation, durable idempotency reservation,
ambiguous completion, verification-gated success, partial effects, and rollback
as a new authorized lifecycle. Added the corresponding threat-model delta.

## Dependency found

Issue #4 explicitly depends on open issue #9. RFC-0003 therefore defines the
required transition facts and evidence candidates but does not invent the final
audit envelope. It remains Proposed and cannot authorize implementation until
#9 supplies compatible ordering, integrity, redaction, retention, export, and
sink-failure semantics.

## Boundary

No lifecycle schemas, runtime, approval adapter, identity integration,
provider, credential, durable store, verifier, audit sink, or deployment was
implemented.
