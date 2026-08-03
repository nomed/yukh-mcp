# RFC-0004 — Structured, redacted, integrity-verifiable audit evidence

- Status: Accepted
- Authors: Codex
- Created: 2026-08-03
- Accepted: 2026-08-03
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/9
- Depends on: RFC-0001, RFC-0002
- Designed to satisfy: RFC-0003 (Proposed) audit dependency

## Summary

Define a vendor-neutral audit evidence contract that explains what Yukh MCP
received, decided, planned, approved, attempted, observed, verified, and
returned without retaining raw prompts, secrets, credentials, provider bodies,
or private reasoning.

Every event uses a closed, versioned envelope and one registered typed payload.
Correlation and causation bind capability, authorization, lifecycle, execution,
and verification facts through opaque identifiers and canonical digests.
Events are committed to ordered per-stream hash chains with periodic
checkpoints. This makes alteration, insertion, and many gaps detectable when a
trusted checkpoint is retained; it does not make storage immutable or prove
that a malicious writer emitted every event.

## Motivation

Operational evidence is required to investigate denials, stale plans, partial
effects, ambiguous completion, verification failure, and attempted abuse. A
generic logging pipeline is insufficient: free-form messages and serialized
request/provider objects become secret-retention channels, while timestamps and
correlation strings alone cannot expose substitution, reordering, or deletion.

The contract must prevent:

- treating raw prompts, exceptions, policy inputs, or provider bodies as audit;
- leaking credentials or sensitive topology through payloads and diagnostics;
- copying an authorization event to another request, plan, or execution;
- silently changing, inserting, or reordering committed events;
- claiming tamper-proof or immutable storage from an unwitnessed hash chain;
- losing pre-effect evidence while still invoking a provider;
- hiding a real effect because post-effect audit publication failed;
- keeping evidence indefinitely without classification and retention policy.

## Normative language

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and
MAY are normative. Unknown versions, event types, fields, classifications,
integrity algorithms, or projections fail closed at the trusted writer.

## Goals

- define a finite event envelope and typed event registry;
- correlate request, decision, plan, approval, execution, verification, and
  rollback without raw prompt retention;
- exclude secrets by construction and define deterministic projections;
- specify ordering, hashing, checkpoints, verification, and honest limitations;
- define phase-aware behavior when evidence cannot be committed;
- provide retention, legal-hold, deletion, and export requirements;
- remain neutral to audit vendor, database, object store, and signing service.

## Non-goals

- choose a logging vendor, SIEM, database, transport, KMS, or signature format;
- store arbitrary application logs or observability traces in the audit stream;
- retain full policy source, identity claims, prompts, provider requests, or
  target responses;
- prove completeness against a gateway/audit writer compromised before event
  creation;
- guarantee immutable storage, external witnessing, confidentiality at rest, or
  availability without a deployment-specific profile;
- authorize an MCP listener, provider, credential, mutation, or production use.

## Roles and trust boundaries

1. An **evidence producer** creates a typed evidence candidate from one trusted
   gateway phase. It cannot choose sequence or integrity metadata.
2. The **redaction/classification boundary** validates the candidate, reduces it
   to an allowlisted projection, and rejects forbidden or unknown data.
3. The **audit writer** assigns stream, sequence, commit time, previous hash,
   writer identity, and event hash, then durably commits the event atomically.
4. A **checkpoint authority** periodically binds stream position and hash. It
   may be independent from the writer under a deployment profile.
5. The **audit store** persists events and retention metadata. It does not
   authorize operations or modify lifecycle outcomes.
6. An **exporter** produces bounded, access-controlled projections with a
   signed or integrity-bound manifest where configured.
7. A **verifier** validates schema, chain continuity, hashes, checkpoints,
   manifests, and declared gaps without requiring sensitive source data.

Ordinary clients and models do not write audit events, select classification,
control redaction, assign ordering, or read protected evidence. Provider output,
repository content, Project state, Coordination state, and issue content remain
untrusted data.

## Evidence model

An event is an immutable statement that one registered producer observed or
decided one bounded fact at one lifecycle phase. Events are not mutable rows.
Corrections and later observations append new events that causally reference
the earlier event; they never overwrite it.

There are three representations:

- **candidate**: in-memory typed facts from a registered producer;
- **protected event**: the canonical committed record defined by this RFC;
- **projection**: a deterministic, access-controlled reduction for an operator,
  export, metric, or client-visible evidence reference.

Only the protected event participates in the integrity chain. Candidates and
projections are not evidence of durable commit by themselves.

## Version 1 event envelope

The logical closed record is:

```yaml
audit_event_version: 1
event_id: event_example001
event_type: authorization.decision_recorded.v1
classification: protected
occurred_at: 2026-08-03T00:00:01Z
committed_at: 2026-08-03T00:00:01.120Z
producer:
  component_ref: impl_gateway_example001
  instance_ref: instance_example001
correlation:
  trace_ref: trace_example001
  request_ref: request_example001
  authorization_request_ref: authreq_example001
  authorization_decision_ref: decision_example001
  plan_ref: null
  approval_ref: null
  execution_ref: null
  verification_ref: null
  rollback_ref: null
causation:
  parent_event_refs: [event_example000]
subject:
  ref: subject_example001
  kind: workload
capability:
  id: node.inspect
  version: 1.0.0
  definition_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
scope:
  resource_kind: node
  resource_set_ref: resources_example001
  resource_set_digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
  environment_ref: development
outcome:
  status: denied
  reason_codes: [policy_deny_scope]
payload:
  schema_ref: audit.authorization_decision.v1
  value:
    decision_digest: sha256:2222222222222222222222222222222222222222222222222222222222222222
    effect: deny
    basis: explicit
integrity:
  stream_ref: stream_example001
  sequence: 42
  previous_event_hash: sha256:3333333333333333333333333333333333333333333333333333333333333333
  event_hash: sha256:4444444444444444444444444444444444444444444444444444444444444444
  algorithm: sha256_chain_v1
  writer_ref: impl_audit_writer001
```

Every object denies additional properties. Strings, arrays, nesting, event
bytes, parent count, and reason count have explicit bounds. Timestamps use UTC
and are syntactically validated, but ordering authority comes from committed
sequence, not wall-clock order.

`event_id` is globally unique within the deployment profile. All references are
opaque, bounded identifiers rather than embedded records. Nullable correlation
slots are explicit so absence is distinguishable from an older schema that did
not understand the field.

## Correlation and causation

Correlation fields identify one logical operation across phases. Producers MUST
bind identifiers already validated by their governing contract; they cannot
copy client-provided identifiers into authoritative slots without server-side
normalization and collision bounds.

`trace_ref` groups one ingress attempt. `request_ref` binds the RFC-0001 request.
Authorization, plan, approval, execution, verification, and rollback references
are populated when those records exist. Their canonical digests remain in typed
payloads so identifier substitution is detectable.

`parent_event_refs` describe direct causal predecessors, not arbitrary related
events. Initial rules include:

- authorization evaluation is caused by the accepted request event;
- plan creation is caused by the enforced allow decision;
- approval disposition is caused by its request event and exact plan event;
- apply admission is caused by the fresh authorization, plan, and approval
  disposition when required;
- attempt start is caused by durable apply admission;
- verification is caused by an execution observation;
- rollback is caused by the original outcome and its new authorization/plan.

A parent may reside in another integrity stream. Cross-stream causation does not
establish total order; it establishes a verifiable reference whose existence
and digest can be checked under the deployment's consistency rules.

## Subject, capability, and scope

Protected events contain stable subject reference and kind, never display name,
email address, raw claims, bearer material, or session secret. Authentication
context and attribute snapshots are referenced and digested in event-specific
payloads when relevant.

Capability identity, semantic version, and definition digest are authoritative.
Scope uses canonical resource kind plus a protected resource-set reference and
digest. Individual resource identifiers are excluded from the base envelope
because they may reveal sensitive topology. A restricted projection may resolve
the set through separately protected inventory controls. Environment is a
logical reference, never an endpoint or credential locator.

## Classification and data minimization

Version 1 envelope classification is one of:

- `operational`: non-sensitive health and aggregate control-plane facts;
- `protected`: pseudonymous identities, canonical digests, lifecycle outcomes,
  and bounded security reason codes;
- `restricted`: evidence whose authorized resolution may reveal sensitive
  resource topology or security investigation context.

There is no `public` audit event class in version 1. Public documentation and
metrics are separately generated aggregate projections.

Classification is determined by the registered event schema and field registry,
not by producer input. A candidate that cannot be classified, contains an
unknown field, or would require retaining a forbidden value is rejected. The
writer does not attempt heuristic secret masking as a substitute for a closed
schema.

Digests minimize disclosure but are not automatically anonymous. Low-entropy
values MUST NOT be directly hashed into evidence because they can be guessed.
Resource sets, user identifiers, and sensitive attributes use server-issued
opaque references or keyed/tokenized representations defined by a deployment
privacy profile. Raw values remain in their authoritative system, not audit.

## Forbidden content

Candidates, protected events, integrity metadata, checkpoints, and exports MUST
NOT contain:

- credentials, passwords, secrets, private keys, tokens, cookies, or session
  material;
- raw prompts, conversation transcripts, private reasoning, model scratchpads,
  or unrestricted user content;
- raw identity claims, personal data, email addresses, or display names;
- policy source, rule expressions, attribute values, or evaluator stack traces;
- provider request/response bodies, target file contents, command output,
  environment variables, endpoints, or infrastructure addresses;
- unrestricted exception messages, stack traces, SQL, shell, script, query,
  regular-expression, or executable content;
- arbitrary maps, labels, tags, or producer-selected free-form metadata.

Reason and diagnostic text is replaced by registered codes. Where bounded human
explanation is operationally necessary, it is stored outside the integrity
event under a separately classified case-management contract and referenced by
an opaque identifier.

## Event registry

Each event type has an immutable versioned schema, producer allowlist, phase,
classification, required correlations, causal rules, durability requirement,
and projection policy. Version 1 categories are:

| Category | Required event types |
| --- | --- |
| ingress | `request.accepted`, `request.rejected` |
| authorization | `authorization.evaluation_recorded`, `authorization.decision_recorded`, `authorization.enforcement_recorded` |
| planning | `plan.created`, `plan.invalidated`, `plan.expired` |
| approval | `approval.requested`, `approval.approved`, `approval.rejected`, `approval.expired`, `approval.invalidated` |
| apply | `apply.admitted`, `apply.denied`, `execution.attempt_reserved`, `execution.started`, `execution.step_observed`, `execution.completed`, `execution.completion_unknown` |
| verification | `verification.started`, `verification.completed`, `verification.failed`, `operator_review.required`, `operator_review.resolved` |
| rollback | `rollback.requested`, `rollback.admitted`, `rollback.completed`, `rollback.failed`, `rollback.completion_unknown` |
| result | `result.released`, `result.withheld` |
| audit control | `audit.stream_opened`, `audit.checkpoint_created`, `audit.gap_declared`, `audit.export_created`, `audit.retention_applied`, `audit.health_changed` |

The serialized `event_type` includes `.v1`. A semantic outcome belongs in the
typed payload and `outcome`; it MUST NOT be encoded by adding arbitrary event
names. Unknown event types are rejected before commit.

Authorization payloads align with RFC-0002 evidence candidates: request and
decision digests, effect, basis, reason codes, policy revision/digest, attribute
snapshot reference/digest, evaluator reference, constraint digest, obligation
types, and enforcement result. They exclude raw attributes and policy.

Lifecycle payloads align with proposed RFC-0003: plan/approval/execution and
observation digests, transition state, attempt number, per-step state,
verification status, rollback linkage, and sanitized reason codes. Final RFC-0003
acceptance MUST reference the registry rather than define a parallel envelope.

## Redaction and projection

Redaction is deterministic structural projection, not regular-expression
replacement over serialized logs. For each event schema, a projection profile
defines exactly which fields are retained, tokenized, aggregated, or removed.
Unknown source fields fail candidate validation and therefore cannot silently
flow into a projection.

Initial projections are:

- `protected_full`: complete RFC event for authorized security operators;
- `operator_summary`: timing, capability, lifecycle status, bounded reason
  codes, and opaque references, without subject or resolvable target detail;
- `support_case`: minimum bounded facts needed to correlate a reported failure;
- `aggregate_metric`: counters and latency buckets with no event, subject, or
  resource identifiers;
- `client_reference`: only an opaque evidence reference and public error code.

Projection output is a new derived artifact with its own schema, classification,
generation time, source event range/digests, profile version, and exporter
identity. It is never inserted into the protected chain as if it were the
original event.

## Ordering and atomic commit

Events are ordered in finite logical streams. A deployment chooses a stable
partition key such as gateway security domain; it MUST NOT create per-subject or
per-resource streams when that would leak identity or topology through stream
names. Stream references are opaque.

Within a stream the writer atomically assigns a strictly increasing integer
`sequence` and the hash of the immediately previous committed event. Sequence
zero is a registered stream-opening event with the profile's genesis value.
Concurrent producers submit candidates; only the writer establishes order.

Wall clocks may skew and `occurred_at` may precede another event with a lower or
higher commit sequence. Investigation uses sequence for commit order, causation
for lifecycle order, and timestamps only as bounded observations. Producers
whose clocks exceed the deployment skew bound are rejected or marked with a
registered time-quality status; timestamps are never silently rewritten.

Writer commit of event bytes, sequence, previous hash, and idempotent event ID
MUST be atomic. Re-submission of the exact same event ID and candidate digest
returns the existing commit. Reuse with different content is an integrity
incident and is rejected.

## Hash chain and checkpoints

`sha256_chain_v1` computes the event hash over the canonical event envelope
excluding `integrity.event_hash` and any external signature, while including
stream, sequence, previous hash, writer identity, and every typed payload field.
Canonicalization rules are versioned and tested with fixed vectors. Algorithm
agility requires a new registry value and an explicit chain-transition event.

Hash chaining detects modification, insertion, and reordering after a trusted
anchor. It does not by itself detect truncation after the last retained anchor,
prevent deletion, prove that the writer observed every real-world action, or
protect against a compromised writer recomputing an entirely unwitnessed chain.

Checkpoints bind stream reference, inclusive sequence range, terminal hash,
event count, creation time, writer reference, checkpoint authority, algorithm,
and previous checkpoint reference. A deployment profile defines interval,
signature/MAC mechanism, key custody, publication or independent witness, and
verification frequency. Until such a profile is accepted, evidence is described
as **hash-chained and integrity-verifiable**, not immutable or tamper-proof.

Detected mismatch, sequence gap, invalid checkpoint, reused event identity, or
unexpected chain reset creates a restricted integrity incident and
`audit.health_changed`. A chain cannot self-attest the event reporting its own
corruption; the verifier records that incident in an independent healthy stream
or external control plane.

## Availability and phase-aware failure

Evidence durability is part of enforcement, not best-effort logging.

Before provider authority crosses the gateway boundary, all required request,
authorization, plan, approval, apply-admission, and attempt-reservation events
MUST be durably committed to a qualified writer. Failure, timeout, classification
error, backpressure, or unhealthy integrity state denies the operation with
`audit_unavailable`. An in-memory queue is not durable commit.

After a provider attempt starts, audit failure cannot undo a possible effect.
The gateway MUST preserve the effect/outcome state in a separately qualified
durable recovery journal, withhold success, return a bounded
`operation_outcome_unknown` or `audit_unavailable` result as appropriate, and
require reconciliation/operator review. It MUST NOT retry solely because the
audit sink failed.

The recovery journal uses the same forbidden-content and bounded-schema rules
but is not represented as committed audit evidence until successfully imported
with explicit original observation time, import time, cause, and declared gap.
Deployment of mutation requires both the primary writer and recovery journal to
have accepted durability, capacity, confidentiality, and recovery profiles.

Read-only capabilities may use a policy-defined availability mode only when an
accepted threat review proves that temporary protected evidence loss cannot
hide an effect, authorization failure, or existence-sensitive disclosure. The
Foundation default remains fail closed.

## Retention, holds, and deletion

Every event type and projection has a registered retention class with minimum
and maximum duration, purpose, classification, permitted jurisdictions,
authorized readers, and deletion method. Producers cannot extend retention.
Sensitive resolvers for opaque references SHOULD have shorter, independently
controlled retention than integrity events.

Legal or incident holds are explicit protected records with authority, scope,
reason code, issue and expiry times, and review cadence. Holds never add raw
content to an event and cannot silently become indefinite.

Retention deletion may make old event bodies unavailable. The system preserves
a non-sensitive deletion manifest or checkpoint sufficient to state the stream
range, retention class, deletion time, authority, method, and terminal integrity
anchors without reconstructing forbidden content. The UI and exporter MUST
distinguish `retained`, `expired_by_policy`, `held`, `missing`, and
`integrity_failure`.

This RFC defines semantics, not universal durations. Deployment profiles must
select durations from applicable operational, privacy, contractual, and legal
requirements. “Keep forever” is not an acceptable default.

## Export

Exports require explicit authorization independent of capability execution.
They are bounded by time, stream range, event type, classification, projection
profile, record count, and byte size. Bulk raw-store access is not an export
API.

An export manifest binds export identity, requester reference, authorization
decision, projection version, query digest, included stream ranges and event
hashes/checkpoints, omissions and retention gaps, generation time, exporter
implementation, output digest, and integrity mechanism. The manifest never
claims completeness beyond its declared ranges and anchors.

Exported artifacts preserve classification and access expiry. They exclude
writer keys, resolver data, credentials, raw source records, and forbidden
content. Export failure produces no partially trusted artifact; temporary files
are bounded and securely disposed under the deployment profile.

## Access control and separation of duties

Audit write, verify, checkpoint, resolve opaque identities, export, administer
retention, and read restricted evidence are separate permissions. Provider
credentials grant none of them. Audit readers cannot invoke capabilities or
alter lifecycle state.

Every protected read, resolution, export, hold, retention action, and integrity
administration attempt is itself audited through a control stream that avoids
recursive payload capture. Break-glass access requires a future accepted profile
with independently reviewable authority and expiry.

## Failure semantics

| Condition | Required result |
| --- | --- |
| unknown/forbidden candidate field | reject candidate; pre-effect operation denies |
| classification or projection failure | fail closed; do not serialize raw fallback |
| writer unavailable before provider start | `audit_unavailable`; no provider call |
| writer unavailable after provider start | preserve recovery fact; withhold success; reconcile |
| duplicate event ID with same digest | return original commit idempotently |
| duplicate event ID with different digest | integrity incident; reject |
| sequence/hash/checkpoint mismatch | quarantine affected range; integrity incident |
| retention-expired body | report `expired_by_policy`, never `missing` |
| undeclared gap or missing event | report incomplete/integrity failure |
| unauthorized projection/export | deny and audit the attempt |

No failure path logs the rejected raw candidate or exception object.

## Compatibility and versioning

Envelope, event type, payload schema, classification registry, projection,
canonicalization, hash algorithm, checkpoint, retention class, and export
manifest versions evolve independently. Consumers reject unknown mandatory
semantics. Adding a field to a closed digest-covered envelope is breaking unless
a new version and canonicalization profile are used.

New optional projection metadata is compatible only when it cannot change the
meaning or integrity of the protected source event. Renaming event types,
changing causal requirements, weakening classification, shortening a required
minimum retention, or redefining reason codes is breaking.

RFC-0001 and RFC-0002 evidence candidates map into this envelope without
changing their authorization semantics. Proposed RFC-0003 must be updated before
acceptance to depend on accepted RFC-0004 and use its event registry and
phase-aware sink behavior.

## Validation and acceptance evidence

Implementation requires:

- positive schema fixtures for every event category and projection;
- negative fixtures for every forbidden field/content category;
- fixed canonicalization, event-hash, chain, checkpoint, and export-manifest
  vectors independently verified by at least two implementations or methods;
- property tests for deterministic projection and object-order independence;
- mutation, insertion, deletion, reorder, truncation, chain-reset, duplicate-ID,
  invalid-checkpoint, and cross-stream substitution tests;
- correlation tests from request through decision and lifecycle outcome;
- failure injection before commit, after commit, after provider start, during
  recovery import, checkpoint, retention, and export;
- tests proving no raw prompt, secret, credential, personal data, provider body,
  policy source, or stack trace enters fixtures or diagnostics;
- bounded record, query, export, and backpressure tests;
- threat-model review and explicit owner acceptance before implementation.

## Rollout

1. Accept RFC-0004 and reconcile proposed RFC-0003 references.
2. Add network-free schemas, registries, canonical vectors, projections, and
   chain verifier.
3. Add an in-memory writer only for conformance tests, clearly non-production.
4. Define and review a durable audit-store and checkpoint deployment profile.
5. Implement authorization evidence before integrating a provider.
6. Add the recovery journal and lifecycle events before any mutation provider.
7. Qualify retention, access, export, monitoring, backup, and recovery controls.

No rollout step authorizes production claims of immutability, tamper-proofing,
completeness, confidentiality, or availability without corresponding deployment
evidence.

## Alternatives considered

### Send existing application logs to a SIEM

Rejected because free-form logs lack closed schemas, exact bindings, causal
semantics, minimization, and portable integrity verification.

### Store raw requests and responses for investigation

Rejected because it creates prompt, credential, personal-data, policy, provider,
and target-content retention channels. Investigations use typed facts, digests,
opaque references, and authorized source-system resolution.

### Redact with regular expressions after serialization

Rejected because unknown fields and encodings bypass pattern filters. Structural
allowlisting prevents forbidden values from entering the event.

### Use one global total-order stream

Rejected as a universal requirement because it creates availability and scaling
coupling. Per-domain streams plus causal references and checkpoints provide
bounded ordering without claiming a global order.

### Call a hash chain immutable or tamper-proof

Rejected because a writer or store can truncate or replace an unwitnessed chain.
The contract states exactly what anchors and independent controls can detect.

### Continue execution when audit is unavailable

Rejected by default because missing evidence can hide unauthorized or partial
effects. Post-start failure is handled separately because the system cannot
erase a possible real effect.

### Put audit storage semantics in RFC-0003

Rejected because audit spans ingress, authorization, lifecycle, administration,
and export. A single contract prevents incompatible per-phase evidence formats.

## Security considerations

Closed schemas, structural projections, pseudonymous references, atomic ordering,
hash chains, checkpoints, and phase-aware failure reduce disclosure, evidence
substitution, silent modification, unsafe continuation, and misleading
investigation. They do not protect against every producer and writer being
compromised before emission, side-channel inference from timing/volume, resolver
misuse, signing-key compromise, storage denial, jurisdictional error, or an
operator misinterpreting declared gaps. Deployment profiles and independent
review remain required.

## Open questions

The following are intentionally deployment-specific and do not block the
contract semantics, but must resolve before production use:

1. stream partition count and consistency domain;
2. durable store, recovery journal, and atomic sequencing mechanism;
3. checkpoint signing or MAC profile, key custody, and independent witness;
4. retention durations, jurisdictions, backup deletion, and legal-hold authority;
5. resolver, operator, exporter, and verifier identity/access profiles;
6. monitoring thresholds and recovery objectives for audit health.
