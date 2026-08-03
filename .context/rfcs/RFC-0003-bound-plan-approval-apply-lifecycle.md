# RFC-0003 — Bound plan, approval, apply, verify, and rollback lifecycle

- Status: Proposed
- Authors: Codex
- Created: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/4
- Depends on: RFC-0001, RFC-0002, issue #9

## Summary

Define a fail-closed lifecycle for state-changing Yukh MCP capabilities. A
mutation is planned from one exact authorization decision and immutable target
snapshot, optionally approved as one exact plan, re-authorized immediately
before apply, executed at most under its declared idempotency and retry rules,
verified against declared postconditions, and rolled back only through a new
authorized operation.

No plan or approval is a bearer capability. Possession of a record never grants
authority. Every transition is performed by the gateway after independently
validating all digests, identities, freshness bounds, state transitions, and
obligations. Unknown state, stale state, ambiguous completion, verification
failure, and evidence failure never become success.

## Motivation

Authorization answers whether an exact request may proceed under current
policy. It does not prove what a provider will change, preserve that authority
indefinitely, make a client-side confirmation trustworthy, or prove the effect
after invocation. Mutation therefore needs an explicit state machine whose
records cannot be substituted across subjects, targets, policy revisions,
inputs, plans, approvals, executions, or later state.

The lifecycle must prevent:

- approving a summary while applying different normalized input or effects;
- replaying approval against another target, environment, subject, or plan;
- applying after policy, capability, target preconditions, or attributes change;
- retrying a destructive or ambiguously completed operation;
- reporting provider acceptance or process exit as verified success;
- hiding partial effects, failed verification, or unavailable rollback;
- interpreting Project, Coordination, model, repository, or issue state as
  execution authority.

## Normative language

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and
MAY are normative. All lifecycle transitions are server-side, exact-binding,
bounded, and fail-closed.

## Goals

- define immutable plan identity, digest, expiry, and precondition snapshot;
- bind authorization, subject, capability, input, target, and policy to a plan;
- define an approval assertion without selecting an identity protocol;
- require fresh authorization and precondition validation before apply;
- specify idempotency, attempts, ambiguous completion, and unsafe retry rules;
- require declared verification evidence before success;
- make partial failure and rollback availability explicit;
- define transition evidence requirements for the audit contract in issue #9.

## Non-goals

- implement an approval user interface, identity provider, signer, or key store;
- select an authorization evaluator, provider transport, queue, or database;
- define the final audit envelope, storage, integrity, retention, or export;
- implement compensation for arbitrary external systems;
- make unrestricted commands, scripts, provider methods, or shell text valid
  capability inputs;
- authorize a listener, provider, credential, deployment, or production use.

## Authority and roles

The roles are deliberately separate:

1. The **requesting subject** proposes typed capability input.
2. The **gateway** authenticates, authorizes, plans, validates transitions,
   invokes registered providers, verifies results, and emits evidence.
3. The **planner** is a pure registered implementation that derives a bounded
   plan from validated input and target observations. It holds no credentials.
4. The **approval authority** verifies an approval actor and policy-defined
   approval requirements, then returns a decision-bound assertion. It does not
   invoke providers.
5. The **provider** receives a server-created execution command and
   least-privilege credential only after apply admission. It cannot approve or
   expand authority.
6. The **verifier** evaluates declared postconditions from bounded observations.
   Where policy requires independence, it is distinct from the provider result.
7. The **audit sink** accepts sanitized evidence under the contract governed by
   issue #9. Audit unavailability follows the operation's declared phase rules
   and never fabricates success.

Project assignment, Coordination membership, issue status, model output, and
repository content are context only. They cannot authenticate, authorize,
approve, or advance this state machine.

## Lifecycle state machine

The logical states are:

```text
requested
   │ authorize + observe + plan
   ▼
planned ── expiry/change ───────────────► invalidated
   │
   ├─ approval not required
   │
   └─ approval required ─► approved ── expiry/change ─► invalidated
                              │
                 fresh authorize + precondition check
                              ▼
                         apply_admitted
                              │ provider attempt starts
                              ▼
                           applying
             ┌────────────────┼──────────────────┐
             ▼                ▼                  ▼
       effect_observed   no_effect_proven   completion_unknown
             │                │                  │
             ▼                ▼                  └─► operator_review
          verifying          failed
        ┌────┴─────┐
        ▼          ▼
     verified   verification_failed
        │          ├─► operator_review
        ▼          └─► rollback_eligible
    succeeded                │ new authorization + plan
                             ▼
                       rollback lifecycle
```

Transitions not listed are forbidden. States are append-only facts; a later
event never rewrites an earlier observation. `succeeded` is terminal and means
all required postconditions were verified. `failed`, `invalidated`, and
`operator_review` are not success. `completion_unknown` MUST NOT be mapped to
`failed` if doing so could permit an unsafe retry.

## Immutable mutation plan

Plan version 1 binds:

- `plan_id`, `plan_digest`, version, issue time, and expiry;
- the exact planning authorization request and allow decision identifiers and
  digests;
- subject and authentication-context references;
- capability identity/version/definition digest, operation class, and effects;
- canonical resource set and environment;
- normalized input digest, policy bundle revision/digest, and attribute
  snapshot reference/digest;
- planner implementation reference;
- target observation snapshot reference/digest and observation time;
- finite typed steps and their ordered or independent dependency relation;
- declared preconditions and postconditions from registered bounded types;
- predicted effect summary, data classifications, and approval requirement;
- idempotency classification/key binding, attempt ceiling, timeout, retry rule;
- rollback mode and declared compensation capability where available.

The plan digest covers every field except itself using the canonical digest
profile shared with the authorization contract. Human summaries are derived
views and are not authoritative. A summary MUST identify every resource,
effect class, destructive property, rollback limitation, and approval level;
truncation or failed classification blocks approval.

Plans contain no provider endpoint, credential, bearer material, raw policy,
unrestricted command, executable expression, or sensitive target value.
Provider-native instructions are created only inside the provider boundary
after apply admission from the immutable typed plan.

Plan expiry is the earliest of authorization expiry, policy validity,
authentication-context validity, attribute freshness, target observation
freshness, capability registration validity, approval-policy maximum, and the
gateway maximum. Expiry cannot be extended in place; re-planning creates a new
identity and digest.

## Preconditions and stale-plan detection

Each precondition has a registered type, bounded schema, deterministic
comparison, observation source, freshness limit, classification, and failure
behavior. Initial categories are exact resource identity, existence/version,
selected field digest, dependency version, capacity bound, and absence of a
conflicting execution lease.

Immediately before apply, the gateway re-observes every required precondition.
Missing, stale, malformed, incomparable, differently classified, or changed
preconditions invalidate the plan. Policy, attributes, capability definition,
resource canonicalization, environment, normalized input, and approval
requirements are also rechecked. The provider is not called after invalidation.

Policy cannot weaken a capability precondition. Client input cannot supply an
authoritative observation. A plan cannot be patched: any changed input, target
set, predicted effect, constraint, obligation, or precondition creates a new
plan and, when required, a new approval.

## Approval assertion

An approval assertion version 1 binds:

- `approval_id`, version, decision (`approve` or `reject`), issue time, expiry;
- approval actor reference, authentication-context reference and strength;
- approval authority implementation and policy reference;
- exact `plan_id` and `plan_digest`;
- planning authorization request/decision digests;
- subject, capability definition, normalized input, resource set, environment,
  target snapshot, policy revision, and attribute snapshot digests;
- required and satisfied approval level;
- sanitized reason code and assertion digest.

The approval actor is authenticated independently and need not equal the
requesting subject. Self-approval is allowed only when an accepted policy
explicitly permits it; destructive and critical operations default to
separation of duties. Version 1 supports one required approval assertion.
Quorum, delegation, approval chains, and break-glass require a future RFC.

Only `approve` satisfying at least the required level permits progression.
Reject, timeout, authority failure, unknown actor, weak authentication,
incomparable level, malformed assertion, or any binding mismatch denies.
Approval expiry cannot exceed plan expiry. Approval is consumed by one apply
admission attempt and cannot be copied, renewed, or rebound. A fresh plan always
requires a fresh approval when approval remains required.

Approval is not model confirmation, chat consent, a Project status, a GitHub
review, an issue comment, or possession of an identifier. The approval adapter
must prove the actor and assertion under a separately accepted identity and
integrity profile.

## Apply admission

Apply admission is atomic from the gateway's perspective. Before provider
invocation it MUST:

1. validate the plan and all canonical digests;
2. prove the plan is current, unconsumed, and in `planned` or `approved` state;
3. verify the approval assertion when required;
4. build a fresh RFC-0002 authorization request from current server state;
5. obtain a distinct current allow decision and enforce every constraint and
   obligation, including an issue-#4 approval receipt derived only from the
   verified assertion;
6. re-observe and compare all preconditions;
7. acquire the declared concurrency or exclusivity control;
8. durably reserve the plan, approval, idempotency key, and attempt number;
9. persist the required pre-effect evidence candidate under issue #9 rules;
10. construct the provider command from registered typed data.

Failure before step 10 produces no provider call. A crash after durable
reservation but before provable provider start remains observable and follows
the capability's retry rule; it is never guessed safe.

## Idempotency, attempts, and retry

RFC-0001 classifications govern apply:

- `naturally_idempotent`: the same intended state may be submitted again only
  under the declared bounded retry rule and fresh authorization;
- `keyed`: one server-bound key identifies the exact subject,
  capability, plan, resource set, environment, and normalized input. Reuse with
  any different binding is denied;
- `non_idempotent`: no automatic retry after provider start;
- destructive mutation: exactly one attempt and retry `never`.

An attempt starts before authority crosses the provider boundary. Timeouts,
lost responses, gateway restart, provider disconnect, or conflicting provider
reports after that point yield `completion_unknown` unless independent
observation proves effect or no effect. Unknown completion forbids automatic
retry, issuing another plan for the same intent, or claiming rollback safety
until reconciliation establishes current state.

The idempotency store must provide atomic create-if-absent and durable binding.
Process-local memory is insufficient for a production gateway. Storage failure
denies apply.

## Execution result and partial failure

Each bounded step records `not_started`, `started`, `effect_observed`,
`no_effect_proven`, `failed`, or `completion_unknown`, plus sanitized reason and
evidence references. For dependent steps, failure stops all not-started
descendants. Independent steps may continue only when the immutable plan says
their effects remain safe and the authorization decision covers them.

The aggregate outcome is:

- `effect_observed` when all intended effects are observed and verification is
  pending;
- `no_effect_proven` only when independent evidence establishes no target
  change;
- `partial_effect` when some but not all intended effects occurred;
- `completion_unknown` when effect state cannot be established.

Partial and unknown outcomes remain visible and require verification or
operator review. They cannot be collapsed into a generic error that encourages
retry. Public errors are bounded; protected evidence retains per-step state
without raw provider bodies or sensitive target data.

## Verification and success

Every mutating capability has finite registered postconditions. A verifier
re-observes the canonical target after execution and produces typed evidence
bound to execution, plan, authorization, resource, environment, and observation
snapshot. Provider-returned values may be inputs but are not sufficient proof
unless the accepted verification profile explicitly makes them authoritative.

`succeeded` requires:

- every intended effect is accounted for;
- every required postcondition is `verified`;
- observations are current and target-bound;
- the required independent verification profile is satisfied;
- result schema, classification, redaction, and evidence requirements pass.

Failed, missing, stale, conflicting, or inconclusive verification withholds
success. It produces `verification_failed` or `operator_review` according to
whether the current state is known. A verification dependency outage cannot
reverse an effect and therefore must report the effect separately from the
unverified outcome.

## Rollback and compensation

Rollback is never an implicit undo flag. It is a new mutation lifecycle with a
new capability request, current authorization, plan, approval when required,
preconditions, execution identity, verification, and evidence. The rollback
plan binds the original execution and observed post-failure state.

Capability definitions declare:

- `not_applicable` for reads only;
- `compensating` for a registered bounded compensation capability whose safety
  and idempotency are independently established;
- `restore` for a registered bounded restoration capability with an exact
  source snapshot and conflict-detecting preconditions;
- `unavailable` when no safe compensation exists.

Manual recovery guidance may accompany `unavailable`, but remains descriptive
and contains no executable content.

Rollback eligibility never guarantees success. If compensation would overwrite
newer legitimate state, its precondition check fails. Rollback failure or
unknown completion remains a distinct observable outcome and cannot erase the
original partial effect.

## Evidence and audit dependency

Every attempted transition emits an evidence candidate containing only
allowlisted identifiers, digests, timestamps, states, reason codes,
classifications, and references. Required transition types are:

- plan created, expired, or invalidated;
- approval requested, approved, rejected, expired, or invalidated;
- apply admitted or denied;
- attempt reserved, started, and completed/unknown;
- step state observed;
- verification started and concluded;
- rollback requested and concluded;
- operator review required and resolved.

Correlation binds authorization request/decision, plan, approval, execution,
attempt, verification, rollback, subject, capability, resource, and environment.
Raw prompts, private reasoning, credentials, tokens, endpoints, provider bodies,
policy source, personal data, and sensitive attribute/precondition values are
forbidden.

Issue #9 defines the final envelope, causation/ordering model, redaction,
integrity, retention, export, and sink failure behavior. This RFC cannot become
implementation-authorizing while that dependency is unresolved. The lifecycle
schemas may reference an abstract `evidence_candidate_ref` but MUST NOT invent a
competing audit envelope.

## Failure semantics

| Condition | State/result | Public code |
| --- | --- | --- |
| plan expired or binding changed | `invalidated` | `plan_invalidated` |
| approval absent, rejected, expired, or mismatched | no apply | `approval_required` or `approval_denied` |
| fresh authorization denies or fails | no apply | RFC-0002 authorization code |
| precondition changed or unknown | `invalidated` | `plan_invalidated` |
| duplicate apply before provider start | original reservation returned or deny | `apply_already_reserved` |
| timeout/disconnect after provider start | `completion_unknown` | `operation_outcome_unknown` |
| some effects observed | `partial_effect` | `operation_partially_applied` |
| postcondition fails or is inconclusive | `verification_failed` or `operator_review` | `verification_failed` |
| rollback unavailable | original outcome retained | `rollback_unavailable` |
| rollback fails or becomes unknown | distinct rollback failure | `rollback_failed` |

Client messages never reveal existence-sensitive target differences, policy
rules, topology, provider internals, or raw observations.

## Compatibility and versioning

Plan, approval, execution, verification, and rollback record versions evolve
independently. Adding a new state, transition, pre/postcondition type, approval
mode, retry behavior, or digest-covered field is breaking unless every older
consumer fails closed. Unknown versions and registry values deny.

Accepted records are immutable. Compatible optional evidence metadata is
allowed only after issue #9 proves that old consumers ignore it safely without
changing authorization, transition, or success semantics.

## Validation and acceptance evidence

Implementation requires, at minimum:

- schema fixtures for every record and transition;
- cross-subject, cross-plan, cross-target, cross-environment, cross-policy,
  changed-input, changed-capability, and expired approval replay tests;
- stale and incomparable precondition tests;
- crash-boundary tests before reservation, after reservation, before provider
  start, and after ambiguous provider start;
- property tests proving attempt ceilings and no automatic retry from unknown;
- partial-step and independent-step failure fixtures;
- verification tests proving provider success alone cannot produce success;
- rollback conflict, failure, and unknown-outcome tests;
- sanitized diagnostics and evidence fixtures under the accepted #9 envelope;
- threat-model review and explicit owner acceptance before implementation.

## Rollout

1. Accept this RFC only after issue #9 supplies a compatible evidence contract.
2. Add network-free schemas and pure state-transition validators.
3. Add an in-memory reference lifecycle for tests, clearly non-production.
4. Integrate fresh RFC-0002 authorization and verified approval assertions.
5. Add durable idempotency/attempt storage behind a reviewed interface.
6. Implement a read-only vertical slice before any mutation provider.
7. Review each provider and deployment profile separately.

No rollout step authorizes a mutating provider until its capability RFC,
provider threat review, identity/approval integrity profile, audit sink, and
operational safeguards are accepted.

## Alternatives considered

### Treat approval as a boolean on the request

Rejected because it has no independently authenticated actor, plan binding,
freshness, integrity, or replay protection.

### Approve capability and target without approving a plan

Rejected because normalized input, preconditions, predicted effects, and
rollback limitations could change after approval.

### Reuse planning authorization at apply

Rejected because policy, identity context, attributes, target state, and
capability registration may change. Apply requires a distinct fresh decision.

### Retry on timeout when an idempotency key exists

Rejected as a universal rule. A key prevents duplicate intent only when the
provider and durable store honor the exact binding; ambiguous completion still
requires reconciliation under the declared capability semantics.

### Roll back automatically inside the failed execution

Rejected because compensation is a new mutation against a new state and needs
current authorization, preconditions, verification, and evidence.

### Define the audit envelope here

Rejected because issue #9 owns cross-lifecycle evidence, integrity, retention,
and export. This RFC defines required facts and transitions without fragmenting
that contract.

## Security considerations

The lifecycle reduces approval substitution, stale-plan execution, unsafe
retry, false success, and hidden partial failure. Residual risks remain around
approval identity proof, planner/provider compromise, observation integrity,
distributed atomicity, durable reservation availability, independent verifier
quality, audit sink integrity, and operator handling of unknown outcomes. These
must be addressed by issue #9 and later identity, provider, storage, and
deployment profiles; this RFC makes no production-security claim.

## Open questions

The following must resolve before acceptance:

1. Issue #9 must define the compatible evidence envelope and sink failure rules.
2. The approval identity and assertion integrity profile must be selected before
   integrating a real approval authority.
3. Durable reservation storage semantics require a deployment-specific design
   before mutation is enabled.
