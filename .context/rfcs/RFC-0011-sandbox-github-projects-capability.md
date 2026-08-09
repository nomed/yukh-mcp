# RFC-0011 - Sandbox GitHub Projects Effect B capability

- Status: Proposed
- Authors: Copilot
- Created: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite decision: accepted `nomed/nomed.github.io` RFC-0005 on `main` at
  `12d9215f10c4b7fb1762a5025367e3e81543800f` (PR #42)
- Depends on: RFC-0001, RFC-0002, RFC-0003, RFC-0004, RFC-0005, RFC-0006,
  RFC-0010
- Blocked by: https://github.com/nomed/yukh-projects/issues/150
- Producer baseline:
  `nomed/yukh-projects v1.7.0@71784218366805922e5a12903eef9073f715f59f`

This proposal is a contract-review gate only. It authorizes no implementation,
registration, discovery, gateway wiring, workflow activation, endpoint,
credential, OIDC trust, materializer, provider request, GitHub request,
mutation, restore, deployment, preview tag, or readiness claim.

RFC-0011 is blocked on acceptance and immutable publication of the
Yukh Projects compound-approval bridge and MCP-safe controlled-apply wrapper
contract governed by `nomed/yukh-projects#150`. No MCP registration skeleton or
provider adapter may be implemented from this proposal while that dependency
is unresolved.

RFC-0007 through RFC-0009 govern the separate Project 5 / issue 27 migration
profile. RFC-0008 permanently rejects OIDC materialization only for that fixed
profile. This RFC proposes a new, disjoint suite-preview sandbox profile and
does not modify, reactivate, or reuse the Project 5 profile.

## Summary

Define the first Yukh MCP Effect B mutation contract as
`github.projects.item.status.set@1.0.0`. The capability may set exactly one
preprovisioned synthetic GitHub Projects item from logical status
`mcp_pending` to logical status `mcp_verified` in the
`suite_preview_sandbox` environment. The item, repository, Project, field, and
option are fixed by a later accepted sandbox deployment profile and cannot be
selected through capability input.

Effect B is a compound admission with two independent assertions:

- the strict MCP `ApprovalReceiptV1` binds the MCP plan, authenticated MCP
  subject and context, capability definition, and provider identity through the
  approved plan and operation-set digests; and
- the strict Yukh Projects `SignedApprovalEnvelope` must bind a distinct
  Projects plan, scope, operation set, protected environment, producer versions,
  and the GitHub-observed authenticated principal under an accepted closed
  schema.

Neither assertion authorizes the other. An explicit producer-owned,
independently verifiable cross-binding artifact must prove their exact
relationship before provider admission. Its schema, canonicalization,
signature, trust, and field names are not invented here; they are blocked on
the accepted `nomed/yukh-projects#150` contract.

The provider boundary is also blocked on an immutable MCP-safe Yukh Projects
wrapper contract and artifact from that issue. It may execute only one
`set_field_value` operation produced by a fresh exact Projects plan for logical
field `status`. The MCP lifecycle owns capability authorization, MCP planning,
MCP assertion enforcement, bridge enforcement, durable admission, result
release, and independent verification. Yukh Projects retains authority over
its assertion, Projects observation, reconciliation-plan semantics, mutation
allowlisting, provider preconditions, Coordination nonce and fenced lease use,
and final zero-drift reconciliation.

Effect B is independent from suite RFC-0005 Effect A. It uses a different
synthetic item and a disjoint operation set, and it shares no plan, approval,
authorization decision, snapshot, nonce, lease, idempotency key, credential,
verifier, materialization receipt, or audit chain with Effect A.

Restoration is a distinct
`github.projects.item.status.restore@1.0.0` capability. It requires a fresh
plan, authorization, approval, one-shot material package, Coordination
admission, provider attempt, verification, and audit chain. Restore is never an
implicit undo or automatic response to failure.

## Motivation

The suite RFC accepts component planning and implementation within component
delivery gates, but the current Yukh MCP boundary remains deliberately inert:

- RFC-0001 requires provider qualification, threat review, and immutable
  registration evidence before a capability can enter the registry;
- RFC-0006 says gateway wiring and provider mutation require a later RFC;
- RFC-0007 adds no MCP capability or gateway provider surface;
- RFC-0010 authorizes only disabled, network-free audit adapters; and
- the mutation reference engine and synthetic setting fixture are explicitly
  unregistered and network-free.

Provider registration would cross new authentication, authorization,
credential, network, GitHub, audit, verification, and recovery boundaries.
Those boundaries cannot be inferred from the suite RFC or from the existence of
the provider-neutral lifecycle engine.

## Goals

- freeze one exact Effect B capability and one exact restore capability;
- keep the public schemas free of provider identifiers, credentials, endpoints,
  arbitrary fields, arbitrary values, queries, commands, and workflow inputs;
- bind the target through one server-owned sandbox profile;
- require distinct planning and apply authorization decisions under RFC-0002;
- require separately signed and verified MCP and Projects assertions;
- require an accepted exact cross-binding bridge artifact without making
  either assertion authority for the other;
- use one atomic, one-shot OIDC material package with distinct read and write
  credentials;
- invoke only a future immutable MCP-safe Yukh Projects wrapper artifact
  accepted under `nomed/yukh-projects#150`;
- preserve Yukh Projects nonce, lease, precondition, mutation, and convergence
  semantics without reimplementation;
- durably commit all required RFC-0004 evidence and the RFC-0010 attempt
  reservation before provider start;
- verify through a separate read-only adapter that does not trust provider
  output;
- preserve durable `completion_unknown` and prohibit automatic retry; and
- make restoration independently governed and conflict detecting.

## Non-goals

- register or expose either capability;
- add a tool to the ordinary gateway or demo;
- implement a provider, verifier, materializer, approval adapter, identity
  adapter, Coordination profile, or sandbox;
- define or implement the producer-owned cross-binding artifact or wrapper;
- directly compose Yukh Projects internal ports or exported primitives before
  their MCP-safe wrapper contract is accepted;
- enable a GitHub Actions workflow or request `id-token: write`;
- configure OIDC federation, an Actions environment, a materializer origin, a
  trust root, a Coordination endpoint, a GitHub App, or credentials;
- call GitHub, Yukh Projects, Coordination, or a materializer;
- reuse the Project 5 workflow, secret, target, policy, plan, or approval;
- use `YUKH_PROJECTS_WRITE_TOKEN`, `GH_TOKEN`, or ambient `GITHUB_TOKEN`;
- add a generic Projects field, GraphQL, REST, workflow-dispatch, shell, or
  command capability;
- approve a plan, perform Effect A or Effect B, restore state, deploy, publish a
  preview, or claim production readiness; or
- change accepted Yukh Projects planning or controlled-mutation semantics.

## Preview profile

The logical profile identifier is
`yukh-mcp/suite-preview-effect-b-status-v1`.

The profile binds exactly:

- environment `suite_preview_sandbox`;
- resource kind `github_project_item`;
- one canonical logical resource reference `preview_effect_b_item`;
- one preprovisioned synthetic repository, Project, issue, item, and single
  select field resolved only from trusted deployment configuration;
- logical field key `status`;
- initial option key `mcp_pending`;
- intended option key `mcp_verified`;
- one native Yukh Projects `set_field_value` operation;
- Yukh Projects mode `apply`;
- Yukh Projects v1.7.0 source commit
  `71784218366805922e5a12903eef9073f715f59f`;
- release artifact `yukh-projects-apply-library-1.7.0.js` with SHA-256
  `e37a6d50f0cc862b4f8c68ec5b9be2386184a69c6800fcbb98cc132e46ffa9a2`;
- the accepted v1.7.0 controlled-apply entrypoint, reconciliation-plan,
  controlled-mutations, and protected-host-capsule contracts; and
- a future immutable wrapper contract and artifact accepted under
  `nomed/yukh-projects#150`, with separately recorded source and artifact
  digests; and
- one fixed policy commit and one fixed protected qualification workflow
  identity selected by a later accepted deployment profile.

The concrete provider-native repository, Project, issue, item, field, and
option identifiers are restricted deployment inputs. They are bound into
protected digests but never capability input, public output, logs, issue text,
repository policy examples, or public evidence.

The three environment domains remain distinct and are bound explicitly:

- MCP policy uses logical environment `suite_preview_sandbox`;
- the accepted Yukh Projects reconciliation-plan operation remains
  `environment: dry-run`; and
- the approval, OIDC assertion, materializer policy, host capsule, and
  controlled-apply entrypoint use one fixed protected workflow environment
  selected by the later deployment profile.

No component infers one environment value from another or treats equality of
display names as authority.

The suite compatibility matrix must prove that Effect A has a different item
and does not contain the Effect B `status -> mcp_verified` operation. A shared
repository, Project, compatibility matrix, or test window is not an
authority-bearing binding.

## Capability definitions

### Set capability

The exact RFC-0001 logical definition is:

```yaml
contract_version: 1
capability:
  id: github.projects.item.status.set
  version: 1.0.0
  summary: Mark one fixed suite-preview Project item as MCP verified
  stability: experimental
resource:
  kinds: [github_project_item]
  cardinality: one
environment:
  required: true
operation:
  model: typed
  class: mutate
  effects: [update]
input:
  schema:
    type: object
    additionalProperties: false
    required: [expected_status, desired_status]
    properties:
      expected_status:
        type: string
        enum: [mcp_pending]
        maxLength: 11
      desired_status:
        type: string
        enum: [mcp_verified]
        maxLength: 12
output:
  schema:
    type: object
    additionalProperties: false
    required: [changed, status, observation_ref, zero_drift]
    properties:
      changed:
        type: boolean
        const: true
      status:
        type: string
        enum: [mcp_verified]
        maxLength: 12
      observation_ref:
        type: string
        pattern: "^[a-z][a-z0-9_.-]{0,127}$"
        minLength: 1
        maxLength: 128
      zero_drift:
        type: boolean
        const: true
risk:
  level: high
  data_classes: [synthetic_project_metadata]
mutation:
  mode: planned
  destructive: false
approval:
  mode: explicit
execution:
  timeout_ms: 120000
  max_attempts: 1
  concurrency: exclusive_scope
  max_input_bytes: 128
  max_output_bytes: 1024
idempotency:
  classification: keyed
  key: required
retry:
  policy: never
verification:
  mode: required
  postconditions:
    - project_item_status_matches
    - projects_fresh_zero_drift
rollback:
  mode: restore
errors:
  taxonomy_version: 1
```

The request must name exactly capability version `1.0.0`, logical resource
`preview_effect_b_item`, environment `suite_preview_sandbox`, and the two enum
input values above. Resource identity, owner, repository, Project, issue, item,
field, option, policy path, workflow, endpoint, provider mode, credential,
approval, nonce, lease, plan, query, and mutation document cannot be supplied
through input.

The result is released only when `changed` and `zero_drift` are true, `status`
is `mcp_verified`, and both registered postconditions independently verify.
Prior convergence produces no Effect B mutation plan and cannot be presented as
the consequential Effect B execution required by the suite RFC.

### Restore capability

The exact restore definition is:

```yaml
contract_version: 1
capability:
  id: github.projects.item.status.restore
  version: 1.0.0
  summary: Restore one fixed suite-preview Project item from an exact snapshot
  stability: experimental
resource:
  kinds: [github_project_item]
  cardinality: one
environment:
  required: true
operation:
  model: typed
  class: mutate
  effects: [update]
input:
  schema:
    type: object
    additionalProperties: false
    required:
      - source_snapshot_digest
      - original_execution_ref
      - original_execution_digest
      - original_plan_digest
    properties:
      source_snapshot_digest:
        type: string
        pattern: "^sha256:[0-9a-f]{64}$"
        minLength: 71
        maxLength: 71
      original_execution_ref:
        type: string
        pattern: "^[a-z][a-z0-9_.-]{0,127}$"
        minLength: 1
        maxLength: 128
      original_execution_digest:
        type: string
        pattern: "^sha256:[0-9a-f]{64}$"
        minLength: 71
        maxLength: 71
      original_plan_digest:
        type: string
        pattern: "^sha256:[0-9a-f]{64}$"
        minLength: 71
        maxLength: 71
output:
  schema:
    type: object
    additionalProperties: false
    required: [changed, status, observation_ref, zero_drift]
    properties:
      changed:
        type: boolean
      status:
        type: string
        enum: [mcp_pending]
        maxLength: 11
      observation_ref:
        type: string
        pattern: "^[a-z][a-z0-9_.-]{0,127}$"
        minLength: 1
        maxLength: 128
      zero_drift:
        type: boolean
risk:
  level: high
  data_classes: [synthetic_project_metadata]
mutation:
  mode: planned
  destructive: false
approval:
  mode: explicit
execution:
  timeout_ms: 120000
  max_attempts: 1
  concurrency: exclusive_scope
  max_input_bytes: 512
  max_output_bytes: 1024
idempotency:
  classification: keyed
  key: required
retry:
  policy: never
verification:
  mode: required
  postconditions:
    - project_item_status_matches_source_snapshot
    - projects_fresh_zero_drift
rollback:
  mode: unavailable
  rationale: A second automatic restore could overwrite newer valid state.
  recovery: Reconcile current state, then create a separately approved operator plan.
  stop_conditions:
    - current state differs from the exact restore precondition
    - original execution or source snapshot binding cannot be verified
    - outcome of this restore attempt is unknown
errors:
  taxonomy_version: 1
```

The restore planner resolves the prior value only from the exact protected
source snapshot bound to the original plan and execution. Version 1 accepts a
source value only when it is `mcp_pending` and the current value is exactly
`mcp_verified`. A changed item, field, option, policy, original binding, or
intervening legitimate state invalidates the restore plan. The requester cannot
supply a replacement value.

Restore's own rollback is `unavailable`: another automatic compensation chain
would create recursive authority and could overwrite newer state. Failure or
unknown restore completion requires operator reconciliation.

## Planning and authorization

Planning and apply use distinct RFC-0002 requests, evaluations, decisions, and
one-shot enforcement receipts.

Planning proceeds only after:

1. the authenticated subject is derived server-side;
2. the exact definition, environment, profile, resource, and input validate;
3. trusted resolvers produce the one canonical target and attribute snapshot;
4. an exact current policy bundle is evaluated;
5. the combined decision is `allow` with basis `explicit`;
6. every constraint and planning obligation is enforceable; and
7. a read-only Projects adapter produces a fresh bounded target snapshot.

No applicable allow, explicit deny, stale data, missing dependency, evaluator
error, unknown field, conflicting constraint, unsupported obligation, or
indeterminate result is a denial and produces no provider call.

The MCP planner creates one RFC-0003 plan with one update step. Its operation
digest binds the fixed profile, capability definition, normalized input,
logical target, policy commit, Yukh Projects producer and future wrapper
contract/artifact digests, fresh Projects plan ID, ordered one-operation digest,
target snapshot, declared provider mode, Coordination epoch, verifier
identities, and postconditions. The MCP `ApprovalReceiptV1` binds that exact
plan and operation-set digest; it does not acquire Projects assertion semantics.

The embedded Projects plan must be executable, contain no diagnostic, contain
exactly one `set_field_value` operation for logical field `status`, require the
exact old value, and propose the exact desired option. Any schema creation,
option creation, relationship, issue-type, additional field, clear, delete,
remove, archive, batch, or second item operation invalidates the MCP plan.

Immediately before provider start, MCP obtains a new RFC-0002 apply decision
from current server state. It must be distinct from the planning decision,
issued after approval, explicitly allow the same exact bindings, and have every
constraint and obligation enforced. Authentication, discovery, planning allow,
approval, materialization, Coordination success, workflow admission, or
provider capability cannot substitute for this decision.

## Compound approval and bridge

Effect B admission requires two separately signed, separately verified
assertions plus one explicit reviewed cross-binding artifact.

### MCP assertion

The MCP assertion is exactly the closed RFC-0003 `ApprovalReceiptV1`. It binds
the exact MCP plan and digest, authenticated MCP subject and authentication
context, capability definition, normalized input, resource set, environment,
policy, target snapshot, and operation-set digest. The MCP plan operation digest
also binds the future accepted wrapper identity and artifact digest, so the
strict assertion covers the provider without adding fields to its schema.

The MCP assertion is verified only by the MCP approval adapter against an
MCP-selected trust profile. Its nonce digest is distinct from the Projects
nonce, is consumed only by the MCP lifecycle reservation/enforcement path, and
never crosses into Yukh Projects as provider approval.

### Projects assertion

The Projects assertion is exactly the immutable producer's closed
`SignedApprovalEnvelope` and `ApprovalClaims` schema, or a separately accepted
version from `nomed/yukh-projects#150`. It binds the distinct Projects plan and
operation digest, repository/Project/issue scope, `environment: apply`,
protected environment, producer contract/planner/snapshot/entrypoint versions,
expiry, nonce, key fingerprint, issuer, and Projects `subjectRef`.

The upstream contract must define how `subjectRef` is derived from and bound to
the GitHub-observed authenticated principal. RFC-0011 does not reinterpret that
opaque value or add identity fields to the closed v1.7.0 assertion. The Projects
assertion is verified only under the Projects-selected trust profile and is the
only assertion presented to the controlled-apply producer.

### Cross-binding bridge

Neither assertion can be parsed as, converted into, or substituted for the
other. Their actors, subjects, plans, schemas, nonces, trust roots, verification
receipts, and authority remain distinct.

Before MCP apply admission, a producer-owned bridge artifact must establish
exact equality or an explicitly accepted mapping across the MCP plan, Projects
plan, fixed target, disjoint Effect B operation set, environments, policy
commit, producer/wrapper identities, expiry window, and authenticated principals.
The bridge is evidence of an exact compound relationship; it is not an
approval, bearer capability, credential, authorization decision, or permission
to invoke either component.

The bridge artifact's identifier, schema fields, canonical bytes, signature
domain, issuing authority, trust root, expiry, replay semantics, and validation
API must be defined and accepted by `nomed/yukh-projects#150`. Until then, this
RFC is blocked. MCP must not invent an extension object, overload assertion
fields, compare only human-readable summaries, or trust a materializer-created
ad hoc mapping.

Neither assertion or bridge is shared with Effect A. Approval cannot be inferred
from authentication, chat, issue or Project state, workflow dispatch,
environment review, OIDC claims, package retrieval, credential possession,
Coordination outcome, provider response, or test status. Private signing keys
never enter MCP, GitHub Actions, Yukh Projects, repository content, or evidence.

## One-shot OIDC materialization

The only proposed credential path is the OIDC-bound one-shot shape accepted by
suite RFC-0005. A later deployment profile must fix the workflow file and
commit, protected environment, repository identity, audience, materializer
origin and trust, package schema, credential issuers and permissions, expiry,
and teardown.

The protected qualification workflow obtains one OIDC assertion. A fixed
materializer verifies at least repository identity, workflow ref and digest,
environment, event, run ID, run attempt equal to one, policy commit, MCP plan
digest, Projects plan ID, both assertion digests, the accepted bridge artifact
digest, operation-set digest, wrapper identity, profile, audience, issue and
expiry. It then atomically returns one closed package no
larger than 64 KiB containing:

1. one short-lived GitHub read credential;
2. one distinct short-lived GitHub write credential;
3. the exact signed MCP assertion and its independently selected trust root;
4. the exact signed Projects assertion and its independently selected trust root;
5. the accepted cross-binding bridge artifact and its trust material;
6. one bounded Yukh Projects protected host capsule; and
7. one single-use package receipt bound to the exact run and both plans.

The package is retrieved once with one direct TLS request, one deadline, no
redirect, proxy discovery, refresh, polling, fallback, or retry. An ambiguous
retrieval consumes the run and requires a new plan, approval, run, and package.
It cannot trigger provider execution.

Materialization occurs before MCP can validate the assertions because the
package delivers them and their independently selected trust roots. Retrieval
itself grants no MCP authorization. MCP validates the package, verifies only
the MCP assertion through its approval adapter, verifies the bridge through the
accepted bridge validator, obtains and enforces the fresh apply authorization,
reserves the attempt, and commits required audit evidence before the provider
receives either credential. The wrapper independently verifies the Projects
assertion through the accepted Projects verifier.

Assertion, bridge, and trust-root files are private bounded regular files or
equivalently bounded handles. The host capsule remains below the accepted Yukh
Projects limit. Credentials are masked before any consumer step. The read
credential is available only to fixed read adapters and the write credential
only to the fixed controlled mutation transport. Both are removed in an
unconditional finalizer. Cleanup failure cannot erase a possible effect and
becomes operator-review evidence.

Repository inputs, environment variables, command arguments, workflow inputs,
outputs, artifacts, caches, summaries, logs, errors, audit events, and model
context contain no credential, token, key, proof, assertion bytes, bridge bytes,
host capsule, package, receipt secret, endpoint, or provider identifier.

## Coordination nonce and lease

Yukh Projects controlled apply remains authoritative for consuming the Projects
assertion nonce and acquiring the repository-Project-issue fenced lease through
the accepted protected host capsule. MCP must not preconsume that nonce or
acquire a competing lease, because that would make the immutable producer
reject the only attempt.

Before provider start, MCP independently:

- consumes the distinct MCP assertion nonce through its own one-shot durable
  lifecycle enforcement;
- binds both assertion digests, both nonce digests, the accepted bridge digest,
  positive Coordination epoch, lease scope digest, holder digest, and expected
  provider operation into its durable reservation and audit records;
- validates that the closed host capsule matches the approved profile and exact
  protected binding; and
- proves that no package, nonce, lease, or capability from Effect A is present.

During the one provider attempt, the immutable Projects host:

1. performs its complete fresh preflight;
2. verifies the Projects assertion and consumes its exact nonce once;
3. acquires the exact fenced lease;
4. re-observes and recreates the same Projects plan;
5. sends at most one allowlisted mutation request; and
6. verifies and releases the lease under its accepted semantics.

Only `consumed` and `acquired` satisfy the respective producer gates. Replay,
conflict, stale epoch or fence, lease loss, malformed response, timeout, or
Coordination unavailability stops without retry. Nonce or lease success is not
approval, MCP authorization, provider success, or verification.

## Provider boundary and upstream wrapper dependency

The future provider is a Yukh MCP-owned adapter behind
`LifecycleEffectPort`. It receives only the exact immutable MCP plan, execution
reference, attempt number one, abort signal, and private runtime handles created
from the validated package.

The immutable v1.7.0 apply artifact actually exports
`parseProtectedHostCapsule`, `createControlledApplyHostFactory`, and
`runApplyEntrypoint`. The accepted v1.7.0 data flow parses the protected capsule,
passes its bounded options into `createControlledApplyHostFactory`, calls the
factory's `create` method with reconciliation mode `native-v1`, fixed requested
scope, fixed policy source, and distinct read/write tokens, then passes the
returned `scope` and `host` with the approved Projects plan ID, protected
environment, Projects assertion, and Projects public key to
`runApplyEntrypoint`.

Those exports are producer primitives, not a reviewed MCP provider API.
v1.7.0 does not export one function that accepts the compound admission,
validates the bridge, fixes every host input, and returns one MCP-safe closed
outcome. Direct consumer composition would create unreviewed glue across
credentials, policy, host construction, approval, Coordination, network, and
result mapping.

RFC-0011 is therefore blocked on `nomed/yukh-projects#150`, which must accept
and immutably publish one reproducible wrapper contract/artifact. The wrapper
must own the exact composition above, accept the Projects assertion and accepted
bridge only through closed bounded inputs, fix native mode and target scope,
validate the bridge before provider access, and expose one narrow exported
function with closed stable outcomes. Its source commit, artifact digest,
provenance, SBOM, and conformance vectors become mandatory profile bindings.

The MCP adapter may invoke only that future wrapper function. It may not invoke
the v1.7.0 primitives directly, or invoke a CLI, shell, workflow dispatcher,
generic Action runner, dynamic import path, package installer, GraphQL client,
REST client, HTTP client, or GitHub SDK. It cannot construct a query, URL,
method, header, mutation document, provider identifier, or credential.

The wrapper receives fixed native mode `apply`, exact protected scope, policy
commit, approved Projects plan ID, Projects assertion and trust-root handles,
accepted bridge handle, host capsule handle, and distinct credential handles.
It rejects any input or result that reports:

- a different plan ID, scope, mode, producer, operation set, or target;
- more than one operation;
- an operation other than `set_field_value` for logical `status`;
- any retry, deferral after provider start, continuation, partial selector, or
  credential substitution;
- an unknown diagnostic, nonzero remaining drift, or unverifiable output; or
- provider-native identifiers or forbidden content.

The adapter maps only closed producer outcomes to RFC-0003 step states. A
producer return is an observation, never proof of MCP success.

## Durable admission and audit

The RFC-0010 repository-local lifecycle ledger and audit profile are candidate
components for the ephemeral preview only. Their known single-process,
same-host, finite-capacity, unwitnessed, and non-production limitations remain.
A later operational gate must prove that those limitations are acceptable for
the sandbox or select another accepted profile.

Before provider start, the runtime must durably commit:

- request, planning authorization evaluation, decision, and enforcement;
- plan creation;
- approval request and approval verification;
- apply authorization evaluation, decision, and enforcement;
- apply admission; and
- the exact execution-attempt reservation.

The attempt reservation binds the package receipt digest, MCP and Projects
assertion digests and distinct nonce digests, accepted bridge artifact digest,
Coordination epoch and scope digest, producer and wrapper artifact digests,
both plan and operation-set digests, verifier identities, and Effect B
disjointness evidence through accepted bounded references or obligation
receipts. If the existing closed audit schemas cannot represent a required
binding without weakening or omission, implementation is blocked pending a
separate accepted RFC-0004 registry extension.

Audit readiness, health, capacity, classification, canonical validation, or
commit failure before provider start denies, drops private handles, runs the
unconditional cleanup path, and makes no provider call. Audit failure after
possible provider start appends the accepted durable recovery fact, withholds
success, records `completion_unknown`, and never retries.

Audit evidence contains only allowlisted references, digests, states, stable
reason codes, counts, and duration buckets. It excludes raw MCP input,
approval, credentials, OIDC claims, package, capsule, nonce, lease capability,
provider observations, GitHub identifiers, URLs, queries, responses, errors,
private timestamps, and synthetic item content.

## Independent verification

MCP verification is separate from the provider and from the provider's own
targeted and final convergence checks. It uses a separately constructed
read-only adapter and cannot access the write credential, mutation transport,
provider internals, provider response body, or cached provider observation.

After an `effect_observed` provider result, the verifier:

1. re-resolves the exact logical Effect B target from trusted profile state;
2. obtains a fresh read-only Projects observation;
3. verifies logical status `mcp_verified`;
4. reruns the exact accepted Projects planner against the fixed policy;
5. requires an executable plan with zero operations and zero diagnostics;
6. binds the observation and zero-drift plan to the execution, MCP plan, fresh
   apply authorization, resource, environment, producer, and verifier digests;
7. emits only bounded evidence references; and
8. permits success release only after terminal durable audit commit.

Missing, stale, substituted, malformed, conflicting, unavailable, or nonzero
verification is `verification_failed` or operator review. Provider
acknowledgement and Yukh Projects output cannot substitute for MCP observation.

Restore verification follows the same procedure but requires status
`mcp_pending` and zero drift against the exact restore plan.

## Completion unknown and retry

The effect boundary starts immediately before calling the future immutable
MCP-safe Projects wrapper. After that point, abort, crash, timeout, process
restart, lost response, producer ambiguity, Coordination ambiguity, lease loss,
cleanup failure, audit failure, or conflicting observations produce
`completion_unknown` unless independent evidence proves effect or no effect.

`completion_unknown` is durable and terminal for the reservation. Exact replay
returns the stored unknown result without another provider call. The system
must not automatically retry, resume, redispatch, issue a replacement plan for
the same unresolved intent, or run restore.

Operator reconciliation first observes current state without mutation. Any
later effect requires a new intent, plan, approval, OIDC run and package,
idempotency key, nonce, lease, authorization decisions, reservation, provider
attempt, verification, and audit chain.

## Stable failure mapping

Public results use existing bounded error codes:

| Condition | Public result | Provider calls |
| --- | --- | --- |
| unknown, undisclosed, or unaccepted capability | `capability_not_found` | 0 |
| malformed input or wrong logical profile | `schema_validation_failed` | 0 |
| no explicit allow or explicit deny | `authorization_denied` | 0 |
| policy, identity, attribute, or obligation unavailable | `authorization_unavailable` | 0 |
| stale or substituted plan, target, producer, or operation | `plan_invalidated` | 0 |
| missing, rejected, expired, or mismatched MCP assertion | `approval_required` or `approval_denied` | 0 |
| missing, rejected, expired, or mismatched Projects assertion or bridge | `approval_denied` | 0 |
| package unavailable, invalid, replayed, or ambiguous | `authorization_unavailable` | 0 |
| reservation conflict or exact duplicate before start | `apply_already_reserved` | 0 |
| audit unavailable before start | `audit_unavailable` | 0 |
| producer rejects before mutation and proves no effect | `provider_protocol_error` | 1 |
| possible effect with unknown outcome | `operation_outcome_unknown` | 1 |
| independent postcondition failure | `verification_failed` | 1 |
| restore unavailable, failed, or unknown | `rollback_unavailable` or `rollback_failed` | 0 or 1 |

Protected evidence may use allowlisted reason codes to distinguish OIDC,
materialization, Coordination, permission, rate, provider, verification, and
cleanup causes. Raw dependency text is never retained or released.

## Trust boundaries and threat analysis

Proposed boundaries are:

- authenticated MCP subject to deny-by-default policy;
- MCP plan to the MCP assertion authority;
- Projects plan and observed principal to the Projects assertion authority;
- both assertions to the producer-owned cross-binding bridge validator;
- protected workflow OIDC assertion to fixed materializer;
- materializer package to private runtime handles;
- MCP admission to durable audit and reservation stores;
- protected capsule to Coordination nonce and lease primitives;
- MCP provider adapter to the future immutable Yukh Projects wrapper;
- distinct credentials to fixed read and mutation transports;
- GitHub Projects state to independent MCP verifier; and
- original execution state to separately authorized restore.

Primary threats are Effect A/B authority collapse, generic-field widening,
subject or target substitution, assertion-schema confusion, one assertion
authorizing the other, bridge substitution, assertion or package replay, OIDC
claim substitution, credential confusion, host-capsule broadening, duplicate
nonce consumption, stale fencing, wrapper replacement, direct composition of
producer primitives, arbitrary network or query construction, pre-effect audit
bypass, provider success treated as verification, unsafe retry after ambiguity,
automatic restore, and evidence disclosure.

Controls are disjoint exact bindings, closed enum schemas, server-owned target
resolution, two fresh explicit authorization decisions, two separately signed
and verified assertions, an accepted non-authorizing bridge, one-shot package
retrieval, separate credentials, immutable producer and wrapper artifact
digests, producer-owned Coordination gates, durable reservation and
audit-before-effect, one provider attempt, independent fresh zero-drift
verification, durable unknown completion, separately authorized restore, and
structural redaction.

Residual risks include compromise of GitHub, the identity provider,
materializer, approval authority, Coordination deployment, Yukh Projects
artifact, sandbox host, effective user, kernel, filesystem, runner, trust roots,
DNS/TLS, or synthetic target administrator. The repository-local stores do not
provide production confidentiality, independent witnessing, backup, high
availability, or disaster recovery. These risks are not accepted by this
proposal.

## Compatibility

This RFC does not change RFC-0001 through RFC-0010. It instantiates their
accepted contracts for one proposed sandbox profile.

RFC-0008 and RFC-0009 remain authoritative for the separate Project 5 /
issue 27 profile. Their static single-token exception is forbidden here. This
profile requires distinct short-lived read and write credentials and the suite
RFC's OIDC one-shot materialization.

The ordinary gateway must continue to discover zero tools, resources, and
prompts. The read-only demo and synthetic setting qualification remain
unchanged. No accepted exact capability version may later be widened to another
field, value, item, Project, repository, environment, mode, producer, provider,
verification profile, credential path, retry rule, or restore behavior.

Any change to the schemas, bridge, assertion separation, target cardinality,
operation type, scope, producer or wrapper baseline, materialization profile,
Coordination ownership, error meaning, verification, retry, or restore
authority requires compatibility review and, when authority expands or
semantics break, a new RFC and capability version.

## Validation and acceptance evidence

RFC-0011 cannot be accepted for implementation until
`nomed/yukh-projects#150` accepts and immutably publishes the bridge and wrapper
contract/artifact. After both acceptances, a separate implementation issue may
add only an unreachable, disabled registration skeleton and synthetic
conformance tests unless a later accepted gate explicitly authorizes more.
Tests must prove:

- canonical definition and schema validation with fixed digests;
- ordinary gateway discovery remains empty and direct invocation is impossible;
- exact Effect B target and operation-set disjointness from Effect A;
- rejection of every unknown field, value, resource, environment, target,
  capability version, producer, policy, operation, provider mode, and verifier;
- zero provider calls for authentication, authorization, planning, approval,
  materialization, precondition, reservation, audit, and package failures;
- fresh planning and apply decisions are distinct, explicit, current, and
  one-shot;
- independent MCP and Projects assertion verification, strict schema rejection,
  trust-root separation, principal binding, bridge substitution, and proof that
  neither assertion authorizes the other;
- package, assertion, and bridge replay, expiry, ambiguity, and cleanup failure;
- distinct nonce enforcement, lease conflict/loss, epoch mismatch, and proof
  that MCP does not preconsume the Projects assertion nonce;
- immutable wrapper selection and proof that direct primitive composition, CLI,
  shell, dynamic install, generic network, GraphQL, REST, and workflow-dispatch
  paths are absent;
- one exact provider attempt, exact result mapping, partial/unknown outcomes,
  and no hidden retry;
- independent verification rejects provider-only evidence and requires a fresh
  zero-operation Projects plan;
- crash/restart at every reservation, audit, provider, result, verification,
  cleanup, and terminal boundary;
- durable unknown completion returns without a second effect after restart;
- restore requires entirely fresh authority and refuses changed state; and
- records, errors, logs, outputs, artifacts, summaries, and diagnostics contain
  no forbidden material.

No test may use a credential, real endpoint, GitHub request, workflow apply, or
production data.

## Rollout and rollback

1. Review this Proposed RFC, its threat-model delta, and suite RFC alignment.
2. Accept and immutably publish the producer-owned bridge and wrapper contract
   under `nomed/yukh-projects#150`.
3. Update this RFC with the accepted contract, wrapper artifact, and immutable
   digests without weakening either assertion boundary.
4. Obtain explicit owner acceptance of this RFC or revise the proposal.
5. After acceptance, open a separate implementation issue.
6. Implement at most an unreachable, disabled registration skeleton and
   network-free synthetic conformance fixtures under that issue.
7. Require another accepted deployment RFC before configuring OIDC,
   materializer, identity, approval, Coordination, audit, verifier, workflow,
   target, credential, endpoint, or network paths.
8. Require a separate activation review before gateway discovery or invocation.
9. Require a separately reviewed exact Effect B plan and explicit human
   authorization before one live synthetic apply.
10. Require separate authorization for a zero-operation second observation,
   restore, teardown, and operational-readiness acceptance.

Before acceptance, rollback is closing or revising this proposal. After a
disabled skeleton, rollback removes only unreachable code and synthetic
fixtures. It never deletes audit state or changes provider state. After a
future effect, rollback is the separately authorized restore capability; source
reversion alone cannot reverse GitHub state.

## Alternatives

### Reuse the Project 5 single-token profile

Rejected because it is a different target and migration authority, permanently
selects a static secret path, and cannot satisfy suite RFC-0005 Effect B
independence or OIDC materialization.

### Register the synthetic setting provider

Rejected because it proves lifecycle semantics only and has no GitHub Projects,
Yukh Projects, credential, Coordination, or network boundary.

### Expose a generic field update

Rejected because caller-selected field, value, Project, item, or operation
would create a broad GitHub mutation capability and defeat policy review.

### Dispatch a workflow from the provider

Rejected because it adds another GitHub authority and ambiguous asynchronous
boundary, and workflow dispatch is not approval. The proposed provider remains
blocked until a producer-owned MCP-safe wrapper is accepted.

### Let MCP consume the Projects assertion nonce first

Rejected because the immutable Projects controlled-apply host must consume it.
Preconsumption would convert the only attempt into a replay denial. MCP binds
the nonce digest and relies on its own durable reservation without duplicating
the producer's Coordination gate.

### Trust the producer's final report as MCP verification

Rejected because Effect B requires MCP-owned independent postcondition
verification and success release.

### Restore automatically after failure

Rejected because current state may be unknown or legitimately changed.
Restore is a separate high-risk capability with fresh authority.

## Open questions

The owner must explicitly decide:

1. whether the exact capability and restore schemas are accepted;
2. whether the accepted `nomed/yukh-projects#150` bridge schema and wrapper
   artifact preserve both component authority boundaries;
3. whether the existing RFC-0004 event schemas can carry every required
   digest-bound obligation receipt or need a separate registry RFC;
4. whether the repository-local audit and reservation profiles are acceptable
   for the ephemeral preview qualification;
5. which later deployment profile owns OIDC, materializer, both approval
   trust profiles, bridge trust, wrapper loading,
   Coordination, verifier, workflow, and sandbox target configuration; and
6. which exact Effect A target and operation set prove disjointness.

No open question may be resolved by implementation before explicit acceptance.
