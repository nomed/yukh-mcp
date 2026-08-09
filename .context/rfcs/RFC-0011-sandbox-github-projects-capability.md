# RFC-0011 - Sandbox GitHub Projects Effect B capability

- Status: Proposed
- Authors: Copilot
- Created: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite decision: `nomed/nomed.github.io` RFC-0005 at
  `b23f47f2c90ec6b106eb4c9c746f6d1958e0c182`
- Depends on: RFC-0001, RFC-0002, RFC-0003, RFC-0004, RFC-0005, RFC-0006,
  RFC-0010
- Producer baseline:
  `nomed/yukh-projects v1.7.0@71784218366805922e5a12903eef9073f715f59f`

This proposal is a contract-review gate only. It authorizes no implementation,
registration, discovery, gateway wiring, workflow activation, endpoint,
credential, OIDC trust, materializer, provider request, GitHub request,
mutation, restore, deployment, preview tag, or readiness claim.

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

The provider boundary is the immutable Yukh Projects v1.7.0 controlled-apply
library. It may execute only one `set_field_value` operation produced by a
fresh exact Projects plan for logical field `status`. The MCP lifecycle owns
capability authorization, planning, approval enforcement, durable admission,
result release, and independent verification. Yukh Projects retains authority
over Projects observation, reconciliation-plan semantics, mutation
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
- require one independently authenticated, exact, expiring approval;
- use one atomic, one-shot OIDC material package with distinct read and write
  credentials;
- invoke only the immutable Yukh Projects controlled-apply library;
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
        pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
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
        pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
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
        pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
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
logical target, policy commit, Yukh Projects producer and artifact digests,
fresh Projects plan ID, ordered one-operation digest, target snapshot, declared
provider mode, Coordination epoch, verifier identities, and postconditions.

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

## Independent approval

One independent human-governed approval authority authenticates the approver
and signs the exact Effect B plan. The approval follows RFC-0003 and additionally
binds:

- suite RFC and profile versions;
- the fixed Effect B target and disjoint operation-set digest;
- Yukh Projects source, release artifact, entrypoint, and contract versions;
- fixed policy commit and protected workflow identity;
- materialization profile and expected package binding digest;
- Coordination profile and positive restore epoch;
- MCP verifier identities and postcondition digests; and
- one unique approval nonce with at most fifteen minutes of validity.

The approval is not shared with Effect A. The actor is independent from the
requesting workload unless a later accepted policy explicitly permits otherwise.
Approval cannot be inferred from MCP authentication, chat, issue state, Project
state, workflow dispatch, environment review, OIDC claims, package retrieval,
credential possession, Coordination outcome, provider response, or test status.

The approval public trust root is selected by materializer policy and protected
runtime configuration, never by repository content or the envelope itself.
Private signing keys never enter MCP, GitHub Actions, Yukh Projects, repository
content, or evidence.

## One-shot OIDC materialization

The only proposed credential path is the OIDC-bound one-shot shape accepted by
suite RFC-0005. A later deployment profile must fix the workflow file and
commit, protected environment, repository identity, audience, materializer
origin and trust, package schema, credential issuers and permissions, expiry,
and teardown.

The protected qualification workflow obtains one OIDC assertion. A fixed
materializer verifies at least repository identity, workflow ref and digest,
environment, event, run ID, run attempt equal to one, policy commit, MCP plan
digest, Projects plan ID, approval digest, operation-set digest, profile,
audience, issue and expiry. It then atomically returns one closed package no
larger than 64 KiB containing:

1. one short-lived GitHub read credential;
2. one distinct short-lived GitHub write credential;
3. the exact signed approval envelope;
4. its independently selected public trust root;
5. one bounded Yukh Projects protected host capsule; and
6. one single-use package receipt bound to the exact run and plan.

The package is retrieved once with one direct TLS request, one deadline, no
redirect, proxy discovery, refresh, polling, fallback, or retry. An ambiguous
retrieval consumes the run and requires a new plan, approval, run, and package.
It cannot trigger provider execution.

Materialization occurs before MCP can validate the approval because the package
delivers the approval and trust root. Retrieval itself grants no MCP
authorization. MCP validates the package and approval, obtains and enforces the
fresh apply authorization, reserves the attempt, and commits required audit
evidence before the provider receives either credential.

Approval and trust-root files are private bounded regular files or equivalently
bounded handles. The host capsule remains below the accepted Yukh Projects
limit. Credentials are masked before any consumer step. The read credential is
available only to fixed read adapters and the write credential only to the
fixed controlled mutation transport. Both are removed in an unconditional
finalizer. Cleanup failure cannot erase a possible effect and becomes
operator-review evidence.

Repository inputs, environment variables, command arguments, workflow inputs,
outputs, artifacts, caches, summaries, logs, errors, audit events, and model
context contain no credential, token, key, proof, approval bytes, host capsule,
package, receipt secret, endpoint, or provider identifier.

## Coordination nonce and lease

Yukh Projects controlled apply remains authoritative for consuming the approval
nonce and acquiring the repository-Project-issue fenced lease through the
accepted protected host capsule. MCP must not preconsume the same nonce or
acquire a competing lease, because that would make the immutable producer
reject the only attempt.

Before provider start, MCP independently:

- binds the approval nonce digest, positive Coordination epoch, lease scope
  digest, holder digest, and expected provider operation into its durable
  reservation and audit records;
- validates that the closed host capsule matches the approved profile and exact
  protected binding; and
- proves that no package, nonce, lease, or capability from Effect A is present.

During the one provider attempt, the immutable Projects host:

1. performs its complete fresh preflight;
2. consumes the exact approval nonce once;
3. acquires the exact fenced lease;
4. re-observes and recreates the same Projects plan;
5. sends at most one allowlisted mutation request; and
6. verifies and releases the lease under its accepted semantics.

Only `consumed` and `acquired` satisfy the respective producer gates. Replay,
conflict, stale epoch or fence, lease loss, malformed response, timeout, or
Coordination unavailability stops without retry. Nonce or lease success is not
approval, MCP authorization, provider success, or verification.

## Provider boundary

The future provider is a Yukh MCP-owned adapter behind
`LifecycleEffectPort`. It receives only the exact immutable MCP plan, execution
reference, attempt number one, abort signal, and private runtime handles created
from the validated package.

The adapter may invoke only the reviewed exported controlled-apply library
entrypoint from the immutable v1.7.0 artifact. It may not invoke a CLI, shell,
workflow dispatcher, generic Action runner, dynamic import path, package
installer, GraphQL client, REST client, HTTP client, or GitHub SDK. It cannot
construct a query, URL, method, header, mutation document, provider identifier,
or credential.

The adapter passes fixed native mode `apply`, exact protected scope, policy
commit, approved Projects plan ID, approval and trust-root handles, host capsule
handle, and distinct credential handles. It rejects any result that reports:

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

The attempt reservation binds the package receipt digest, approval nonce
digest, Coordination epoch and scope digest, producer and artifact digests,
Projects plan and operation-set digests, verifier identities, and Effect B
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

The effect boundary starts immediately before calling the immutable controlled
apply library. After that point, abort, crash, timeout, process restart, lost
response, producer ambiguity, Coordination ambiguity, lease loss, cleanup
failure, audit failure, or conflicting observations produce
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
| missing, rejected, expired, or mismatched approval | `approval_required` or `approval_denied` | 0 |
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
- MCP plan to independent approval authority;
- protected workflow OIDC assertion to fixed materializer;
- materializer package to private runtime handles;
- MCP admission to durable audit and reservation stores;
- protected capsule to Coordination nonce and lease primitives;
- MCP provider adapter to immutable Yukh Projects controlled apply;
- distinct credentials to fixed read and mutation transports;
- GitHub Projects state to independent MCP verifier; and
- original execution state to separately authorized restore.

Primary threats are Effect A/B authority collapse, generic-field widening,
subject or target substitution, approval replay, OIDC claim substitution,
package replay, credential confusion, host-capsule broadening, duplicate nonce
consumption, stale fencing, provider-version replacement, arbitrary network or
query construction, pre-effect audit bypass, provider success treated as
verification, unsafe retry after ambiguity, automatic restore, and evidence
disclosure.

Controls are disjoint exact bindings, closed enum schemas, server-owned target
resolution, two fresh explicit authorization decisions, independent signed
approval, one-shot package retrieval, separate credentials, immutable producer
and artifact digests, producer-owned Coordination gates, durable reservation
and audit-before-effect, one provider attempt, independent fresh zero-drift
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

Any change to the schemas, target cardinality, operation type, scope, producer
baseline, materialization profile, Coordination ownership, error meaning,
verification, retry, or restore authority requires compatibility review and,
when authority expands or semantics break, a new RFC and capability version.

## Validation and acceptance evidence

After explicit acceptance, a separate implementation issue may add only an
unreachable, disabled registration skeleton and synthetic conformance tests
unless a later accepted gate explicitly authorizes more. Tests must prove:

- canonical definition and schema validation with fixed digests;
- ordinary gateway discovery remains empty and direct invocation is impossible;
- exact Effect B target and operation-set disjointness from Effect A;
- rejection of every unknown field, value, resource, environment, target,
  capability version, producer, policy, operation, provider mode, and verifier;
- zero provider calls for authentication, authorization, planning, approval,
  materialization, precondition, reservation, audit, and package failures;
- fresh planning and apply decisions are distinct, explicit, current, and
  one-shot;
- package and approval substitution, replay, expiry, ambiguity, and cleanup
  failure;
- nonce replay, lease conflict/loss, epoch mismatch, and proof that MCP does
  not preconsume the producer nonce;
- immutable provider entrypoint selection with no CLI, shell, dynamic install,
  generic network, GraphQL, REST, or workflow-dispatch path;
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
2. Obtain explicit owner acceptance or revise the proposal.
3. After acceptance, open a separate implementation issue.
4. Implement at most an unreachable, disabled registration skeleton and
   network-free synthetic conformance fixtures under that issue.
5. Require another accepted deployment RFC before configuring OIDC,
   materializer, identity, approval, Coordination, audit, verifier, workflow,
   target, credential, endpoint, or network paths.
6. Require a separate activation review before gateway discovery or invocation.
7. Require a separately reviewed exact Effect B plan and explicit human
   authorization before one live synthetic apply.
8. Require separate authorization for a zero-operation second observation,
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
boundary, and workflow dispatch is not approval. The proposed provider calls
only the fixed in-process controlled-apply library entrypoint.

### Let MCP consume the producer approval nonce first

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
2. whether invoking the immutable controlled-apply library in process is the
   correct provider boundary for the sandbox;
3. whether one approval envelope may be independently verified by MCP and Yukh
   Projects without collapsing their authorization boundaries;
4. whether the existing RFC-0004 event schemas can carry every required
   digest-bound obligation receipt or need a separate registry RFC;
5. whether the repository-local audit and reservation profiles are acceptable
   for the ephemeral preview qualification;
6. which later deployment profile owns OIDC, materializer, approval,
   Coordination, verifier, workflow, and sandbox target configuration; and
7. which exact Effect A target and operation set prove disjointness.

No open question may be resolved by implementation before explicit acceptance.
