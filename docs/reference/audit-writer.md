# Audit writer foundation

The RFC-0004 audit package is a network-free executable foundation for the
pre-effect evidence requirement in RFC-0003 apply admission step 9. It provides:

- a closed typed registry for stream opening and the pre-effect request,
  authorization, plan, optional approval, apply-admission, attempt-reservation,
  provider-start, and completion path;
- typed constructors plus trust-boundary validation that retains only
  structurally allowlisted fields and takes classification from the registry;
- correlation, direct-causation, and digest-binding checks against committed
  parent events;
- writer-assigned per-stream sequence, previous hash, and canonical SHA-256 event
  hash;
- exact duplicate handling and conflicting event-identity rejection;
- retained-range chain verification; and
- lifecycle guards that require durable receipts plus a final typed
  audit-readiness check immediately before provider start, and use a separate
  bounded recovery fact after provider start.

`InMemoryAuditStore` is only a deterministic conformance store. Its receipts are
marked `volatile_test_only`, so `commitBeforeProviderStart` rejects them and does
not call the supplied provider-start callback. Even durable exact-duplicate
receipts are non-authorizing: the guard calls the separate
`RequiredAuditReadiness` port after the final receipt and denies if current
health is failed. The guard requires complete causal evidence through attempt
reservation. Planning authorization is labeled and bound to the plan; after
plan creation and any approval, a distinct apply-phase evaluation, explicit
allow decision, and enforcement triplet is bound to apply admission. A future
store must implement the `AuditStore` port, atomically compare event identity and
stream head, and return `durable` only after committing the exact event bytes,
candidate digest, sequence, and previous hash under a separately accepted
deployment profile.

The repository-local implementation keeps Linux ext-family qualification. It
fails closed on APFS because the supported Node runtime has no descriptor-based
ACL inspection API, and reopening a path for an ACL utility would introduce a
substitution race. It therefore makes no APFS qualification claim.

Canonical JSON sorts object keys by code unit, preserves array order, permits
only validated JSON values, and is covered by an object-order vector and a
fixed event-hash vector. The writer revalidates candidates even when callers
use the typed constructor.

The recovery-journal contract is similarly storage-neutral. A primary-writer
failure after provider start withholds success, attempts one bounded journal
append containing the original typed outcome, plan digest, attempt, and
observation event binding/time. It separately records `completion_unknown` as
the withheld result and never retries provider work. Recovery facts must be
created with `createRecoveryFact` from a separately validated
`execution.started.v1` or `execution.completed.v1` observation; unbound facts
and non-execution candidates never reach the journal. If full candidate
validation fails, recovery accepts only a strictly bounded execution binding
(observation identity/time, correlation, parent, plan digest, attempt, and
outcome) and requires it to exactly match the factory-branded fact.

## Integrity limits

`verifyAuditStream` detects modification, sequence gaps, reordering, chain
reset, and cross-stream substitution within the retained range. The chain is
**integrity-verifiable**, not immutable or tamper-proof. Without a qualified
checkpoint and independent witness it cannot detect all tail truncation, prove
that every real-world action produced an event, or resist a compromised writer
that replaces an unwitnessed chain.

## Stop conditions

This package is not wired into the gateway and registers no provider. It selects
no database, checkpoint authority, key, credential, endpoint, retention policy,
or exporter. It authorizes no live mutation, Project apply, deployment, or
production-readiness claim.
