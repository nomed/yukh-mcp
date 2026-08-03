# RFC-0002 — Deny-by-default authorization contract

- Status: Accepted
- Authors: Codex
- Created: 2026-08-03
- Accepted: 2026-08-03
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/3
- Depends on: RFC-0001

## Summary

Define how Yukh MCP decides whether one authenticated subject may request an
exact capability action against canonical resources in one environment.

The gateway is the policy-enforcement point. It derives identity and scope from
trusted server-side adapters, constructs a bounded authorization request,
obtains a versioned policy evaluation, validates it independently, and enforces
all constraints and obligations before any provider invocation.

`allow` is the only authorizing result. Explicit deny, no matching allow,
unknown values, conflicting policy, stale state, timeout, malformed response,
dependency failure, or unenforceable obligation all produce `deny`. Protected
evidence records the deny basis without disclosing sensitive policy inputs.

## Motivation

Authentication proves an identity under one authentication context; it does not
grant capability, establish resource ownership, satisfy approval, or confer
provider authority. A generic policy result is also insufficient unless the
gateway can prove what subject, action, resource, environment, policy revision,
and input state were actually evaluated.

The contract must prevent:

- treating authentication success as permission;
- accepting client-supplied subject or scope as authoritative;
- using an allow decision for another resource, environment, capability version,
  policy revision, or later state;
- interpreting policy failure or ambiguity as allow;
- allowing constraints or obligations that the gateway cannot enforce;
- leaking sensitive attributes, policy contents, or target topology into model
  context, client errors, or public audit evidence.

## Normative language

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY
are normative. Authorization is server-side, exact-binding, deny-by-default, and
fail-closed. Client content and coordination or project state have no execution
authority.

## Goals

- define canonical subject, action, resource, and environment bindings;
- separate authentication context from authorization decision;
- define explicit deny, default deny, error, and indeterminate deny bases;
- combine applicable policy deterministically;
- define bounded constraint and obligation semantics;
- integrate capability-level approval requirements without weakening them;
- define freshness, policy-revision, caching, and re-evaluation rules;
- produce independently enforceable decisions and sanitized evidence;
- specify cross-resource, cross-environment, replay, and privilege-escalation
  negative cases;
- remain neutral to policy language, identity provider, and evaluator vendor.

## Non-goals

- select or define a policy language such as Cedar, Rego, or XACML;
- define authentication protocols, token formats, session management, identity
  proofing, or delegation;
- let policy define or modify capability schemas or provider implementations;
- define the complete approval and apply lifecycle governed by #4;
- define the complete audit envelope, storage, retention, or integrity governed
  by #9;
- define tenant provisioning, organization hierarchy, or resource inventory;
- authorize an MCP listener, provider, credential, deployment, or production use.

## Detailed design

## Roles and authority

Four roles are distinct:

1. The **authentication adapter** derives a stable subject and bounded
   authentication context from a verified transport/session.
2. The **scope resolver** converts logical request references into canonical
   resource and environment identities from trusted server configuration.
3. The **policy decision point** evaluates a bounded request against one exact
   policy bundle revision and returns a typed evaluation.
4. The **gateway policy-enforcement point** validates bindings, combines policy,
   fulfills constraints and obligations, and prevents planning or provider
   invocation unless the final decision is valid and current.

The policy decision point cannot invoke providers or hold target credentials.
The enforcement point cannot treat an evaluator's network success, signature,
or `allow` string as sufficient; the complete typed decision must validate and
bind exactly.

## Decision flow

For every protected operation, the gateway performs these ordered stages:

1. authenticate the transport/session and derive the subject server-side;
2. resolve the exact capability definition and version;
3. validate and normalize capability input under RFC-0001;
4. canonicalize resource set and environment through trusted resolvers;
5. collect allowlisted policy attributes with source, classification, freshness,
   and integrity metadata;
6. build and digest one immutable authorization request;
7. evaluate one exact policy bundle revision within bounded time and resources;
8. validate and deterministically combine the evaluation;
9. materialize an immutable authorization decision;
10. enforce every constraint and required pre-operation obligation;
11. bind the decision into plan, approval, execution, verification, and evidence.

Failure at any stage produces no authorizing decision and no provider call.

## Authorization request

The logical version 1 record is:

```yaml
authorization_request_version: 1
authorization_request_id: authreq_example7f3a
request_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
subject:
  ref: sub_example001
  kind: workload
  authentication_context_ref: authctx_example001
  authentication_strength: bounded_session
action:
  capability:
    id: node.inspect
    version: 1.0.0
  operation_class: read
  effects: [observe]
resource:
  kind: node
  refs: [node-example-01]
  attributes_digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
environment:
  ref: development
  attributes_digest: sha256:2222222222222222222222222222222222222222222222222222222222222222
request_context:
  normalized_input_digest: sha256:3333333333333333333333333333333333333333333333333333333333333333
  risk: low
  requested_at: 2026-08-03T00:00:00Z
policy:
  bundle_ref: policy_example001
  revision: 17
  digest: sha256:4444444444444444444444444444444444444444444444444444444444444444
attributes:
  snapshot_ref: attrs_example001
  digest: sha256:5555555555555555555555555555555555555555555555555555555555555555
  observed_at: 2026-08-03T00:00:00Z
```

### Subject

`subject.ref`, `kind`, authentication context, and strength are derived by the
authentication adapter and MUST NOT be accepted from capability input or model
content. Version 1 supports `human` and `workload` subjects. Display names,
email addresses, raw claims, bearer material, credentials, and session secrets
are excluded.

Delegation and impersonation are not representable in version 1. A gateway MUST
NOT infer that an agent, child process, Coordination participant, Project
assignee, or approval actor inherits another principal's authority. Delegation
requires a future RFC with an explicit, verifiable chain and reduced scope.

Authentication strength is a bounded registry value, not a policy decision.
Unknown strength fails request construction.

### Action

The action binds the exact RFC-0001 capability identity, semantic version,
operation class, and complete declared effect set. These values come from the
registered definition, not client attributes. Policy cannot change the input or
output schema, select a provider, add effects, convert read to mutation, or
reduce risk and approval metadata.

### Resource

The scope resolver returns one resource kind and a finite, deduplicated,
canonical resource set compatible with the capability definition. Logical input
references are not policy authority. Symlinks, aliases, case variants, tenant
aliases, or provider-native identifiers MUST NOT produce ambiguous canonical
identity.

Version 1 evaluates each canonical resource independently, then combines the
results for the request. A set is authorized only if every resource is allowed
under the same subject, action, environment, policy revision, attribute
snapshot, constraints, and obligations. Partial authorization is forbidden.

Resource attributes are allowlisted and typed. The public decision record binds
their digest and snapshot reference, not raw sensitive values.

### Environment

Every request has exactly one canonical logical environment. It is a policy
scope key, not a deployment endpoint or credential locator. Cross-environment
requests are split into separate authorization requests and cannot share a
decision or approval.

### Attributes and freshness

Policy attributes are obtained only from registered server-side sources. Each
source declares attribute names, types, classification, maximum age, failure
behavior, and integrity/freshness evidence. Client-provided descriptive data may
be evaluated only as untrusted request input and never as identity, ownership,
role, environment, or authority metadata.

The gateway creates one immutable attribute snapshot. Missing required values,
unknown enum values, conflicting sources, source failure, stale observation,
classification failure, digest mismatch, or unsupported attribute type denies
the request. Policy cannot mark an unavailable attribute as safely absent unless
the accepted schema defines absence as a typed value and all applicable rules
handle it explicitly.

## Policy evaluation

The evaluator receives only the bounded request and the exact immutable policy
bundle identified in the record. It MUST NOT receive credentials, raw prompts,
provider output, unrestricted repository content, or arbitrary external lookup
authority.

The evaluator returns zero or more applicable typed statements:

```yaml
evaluation_version: 1
authorization_request_id: authreq_example7f3a
request_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
policy:
  bundle_ref: policy_example001
  revision: 17
  digest: sha256:4444444444444444444444444444444444444444444444444444444444444444
evaluator_ref: evaluator_sha256_example001
evaluated_at: 2026-08-03T00:00:00Z
statements:
  - statement_ref: stmt_allow_read001
    effect: allow
    reason_code: policy_allow_bounded_read
    constraints:
      - type: output_data_class
        value: operational_metadata
    obligations:
      - type: evidence_profile
        value: standard_read
```

Statements use stable opaque references and allowlisted reason codes. Policy
source text, rule expressions, stack traces, raw attributes, and provider or
consumer identifiers are excluded from the runtime result and public evidence.

An evaluator response is invalid if its request, policy, evaluator, time,
statement, constraint, obligation, or digest binding is missing, unknown,
duplicated, stale, malformed, or inconsistent.

## Deterministic combining algorithm

The gateway combines applicable statements for each resource in this order:

1. Any explicit applicable `deny` produces deny basis `explicit`.
2. Any evaluation error, invalid/unknown statement, stale dependency, or
   unsupported semantic produces deny basis `error` or `indeterminate`, even if
   another statement says allow.
3. With no applicable allow, the result is deny basis `default`.
4. One or more applicable allows are intersected. Constraints may only narrow
   authority; obligations accumulate.
5. Conflicting, incomparable, unknown, or unenforceable constraints or
   obligations produce deny basis `indeterminate`.
6. A resource is allowed only when at least one allow remains and the effective
   constraints and obligations are finite, supported, and enforceable.
7. A multi-resource request is allowed only when every resource decision is
   allow and one safe intersection exists for the complete set.

Explicit deny overrides allow. Error and uncertainty also override allow; policy
authors cannot configure fail-open behavior. Rule order, file order, provider
order, and network response order do not affect the result.

## Authorization decision

The immutable version 1 record is:

```yaml
authorization_decision_version: 1
decision_id: decision_example001
decision_digest: sha256:6666666666666666666666666666666666666666666666666666666666666666
authorization_request_id: authreq_example7f3a
request_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
effect: allow
basis: explicit
reason_codes: [policy_allow_bounded_read]
subject_ref: sub_example001
action:
  capability:
    id: node.inspect
    version: 1.0.0
  operation_class: read
resource:
  kind: node
  refs: [node-example-01]
environment_ref: development
policy:
  bundle_ref: policy_example001
  revision: 17
  digest: sha256:4444444444444444444444444444444444444444444444444444444444444444
attribute_snapshot_ref: attrs_example001
constraints:
  - type: output_data_class
    value: operational_metadata
obligations:
  - type: evidence_profile
    value: standard_read
issued_at: 2026-08-03T00:00:00Z
expires_at: 2026-08-03T00:00:30Z
evaluator_ref: evaluator_sha256_example001
```

`effect` is only `allow` or `deny`. `basis` is `explicit`, `default`, `error`,
or `indeterminate`. An allow MUST have `basis: explicit`; every other basis MUST
have effect deny. Error and indeterminate are not third authorization outcomes.

The decision digest covers the canonical request digest, effect, basis, reason
codes, exact bindings, effective constraints and obligations, policy revision,
attribute snapshot, evaluator reference, issue time, and expiry.

A decision is not a bearer capability. Possession of its identifier or bytes
does not authorize reuse. Only the gateway enforcement point may consume it
after verifying the current authenticated subject and every binding.

## Constraints

A constraint narrows an otherwise allowed operation. Each type is registered
server-side with one versioned schema, deterministic intersection behavior, an
enforcer, and evidence requirements. Unknown types deny.

Initial constraint categories are:

- allowed resource subset;
- output data classification and field allowlist;
- maximum result items and bytes;
- operation time window and decision lifetime;
- concurrency or rate ceiling;
- capability-input value subset stricter than the registered schema.

Constraints MUST NOT add resources, effects, inputs, data classes, attempts,
providers, credentials, or time beyond the capability definition and gateway
maximums. The effective value is always the strictest intersection of
capability, gateway, policy, and request bounds. An empty or non-computable
intersection denies.

Every constraint field has an allowlisted data classification. Sensitive
constraint values are retained only inside the enforcement boundary and appear
in evidence as a typed reference and digest; they are not copied into client
responses or ordinary audit views. A constraint whose value cannot be safely
classified, redacted, compared, or enforced denies.

Policy must not return arbitrary code, query, regular expression, endpoint,
provider method, or executable condition as a constraint. Dynamic conditions
are evaluated inside the bounded policy evaluation and reduced to typed results
before the enforcement point receives them.

## Obligations

An obligation is a server-enforced requirement, not advice to the model or
client. Each type has a registered schema, fulfillment phase, enforcement
component, timeout, failure behavior, and evidence receipt. Unknown or
unenforceable obligations deny.

Initial obligation categories are:

- `approval_required` before apply;
- `evidence_profile` before result release;
- `verification_profile` after provider execution and before success;
- `redaction_profile` before output or error release;
- `concurrency_profile` before planning or invocation.

Obligations may strengthen but never weaken capability requirements. An
explicit capability-level approval cannot be removed by policy; policy may
require approval where the capability says `policy`, and may elevate a read to
require approval. Policy cannot authorize a destructive operation without the
explicit approval mandated by RFC-0001.

Failure of a pre-effect obligation stops before provider invocation. Failure of
a post-effect obligation cannot erase an effect: the result becomes failed or
indeterminate as defined by the lifecycle, success is withheld, and operator
review evidence is required. Obligation fulfillment is bound to the exact
decision and cannot be copied to another request or plan.

## Server-side enforcement

Before planning or read invocation, and again before mutating apply, the gateway
MUST verify:

- current subject and authentication context match the decision;
- capability definition/version/digest and operation class are unchanged;
- canonical resource set and environment match exactly;
- normalized input, policy bundle, attribute snapshot, and decision digests
  match;
- decision time, expiry, policy revision, and source freshness remain valid;
- all registered constraints can be enforced at every relevant component;
- all due obligations have valid decision-bound receipts;
- no revocation, changed precondition, or stricter gateway limit applies.

Any mismatch denies and invalidates planning or apply. A provider never receives
an unvalidated decision and never decides whether the subject is authorized.
Defense-in-depth provider checks may narrow or reject but cannot expand the
gateway decision.

## Freshness and re-evaluation

Decision lifetime is finite and bounded by the shortest of policy revision
validity, attribute freshness, authentication context, capability registration,
resource observation, gateway maximum, and any stricter constraint.

Version 1 does not reuse allow decisions. Every invocation constructs a fresh
authorization request, obtains a current evaluation, and produces a distinct
decision. This deliberately excludes positive-decision caches while revocation,
attribute freshness, policy distribution, and lifecycle behavior are still
being established. A later cache or reuse mechanism requires a superseding RFC,
bounded invalidation proof, negative revocation tests, and compatibility review.

Deny results MAY be rate-limited or coalesced only as an availability control
when doing so cannot become an allow, disclose existence-sensitive differences,
or replace the evidence required for an actual invocation attempt.

Mutating apply always re-evaluates authorization against current bindings. A
previous allow, plan, or approval cannot suppress that evaluation. If the new
decision differs, the plan and approval are stale and apply stops; #4 defines
the complete lifecycle.

## Failure semantics

| Condition | Decision | Basis | Public error |
| --- | --- | --- | --- |
| applicable explicit deny | deny | explicit | `authorization_denied` |
| no applicable allow | deny | default | `authorization_denied` |
| missing/stale/unknown attribute | deny | indeterminate | `authorization_unavailable` |
| policy dependency timeout/unavailable | deny | error | `authorization_unavailable` |
| malformed or mismatched evaluator response | deny | error | `authorization_unavailable` |
| unknown/conflicting/unenforceable constraint or obligation | deny | indeterminate | `authorization_unavailable` |
| stale decision or changed binding | deny | indeterminate | `authorization_unavailable` or `plan_invalidated` |

Ordinary clients receive bounded sanitized codes and messages. They do not
receive policy source, rule identity, raw attributes, existence-sensitive
resource details, stack traces, or dependency topology. Authorized operators may
inspect a more specific protected reason code through audit controls.

## Decision evidence and redaction

Every evaluation attempt produces a structured evidence candidate whether the
result is allow or deny. The record binds:

- request and decision identifiers/digests;
- subject reference and authentication-context reference, not raw claims;
- capability identity/version and operation class;
- canonical resource/environment references under classification controls;
- policy bundle reference/revision/digest;
- attribute snapshot reference/digest/freshness, not raw values;
- effect, basis, allowlisted reason codes, constraints, and obligations;
- evaluator implementation reference and timing;
- enforcement result and fulfilled obligation receipt references.

Secrets, credentials, bearer material, raw prompts, private reasoning, full
policy text, rule expressions, personal data, sensitive attribute values,
provider bodies, internal endpoints, and stack traces are forbidden. If required
evidence cannot be classified or redacted safely, authorization fails closed.
The complete audit envelope and retention model remain governed by #9.

## Negative and abuse cases

Implementations MUST cover at least:

- authenticated subject requests an ungranted capability;
- client injects subject, role, owner, tenant, environment, or approval fields;
- allow for resource A is replayed against resource B or an alias of B;
- allow for one environment, capability version, input digest, or policy revision
  is replayed against another;
- one resource in a multi-resource request is denied;
- explicit deny conflicts with allow;
- constraint intersection is empty or unsupported;
- obligation type is unknown, fails, expires, or is copied to another decision;
- attribute source is missing, stale, conflicting, malformed, or unavailable;
- evaluator times out, returns unknown fields, mismatched digest, duplicate
  statements, unknown enum, oversized response, or invalid implementation ref;
- policy changes after plan or approval and before apply;
- a previous allow is presented for reuse or after revocation/freshness loss;
- client error probing attempts to distinguish nonexistent from unauthorized
  resource or capability;
- reason text or attributes attempt to inject secrets into evidence.

Every case denies before provider invocation unless the case occurs after an
effect; post-effect failures remain visible and cannot be converted to success.

## Trust boundaries and threat analysis

This RFC specifies the gateway/identity-policy boundary and binds the
client/gateway, gateway/provider, and runtime/audit boundaries.

- Authentication/authorization confusion is prevented by distinct records,
  adapters, and enforcement stages.
- Confused deputy and target substitution are constrained by canonical exact
  binding and per-resource evaluation.
- Policy injection is constrained by typed allowlisted attributes, immutable
  bundles, bounded evaluators, and no arbitrary lookup or executable outputs.
- Allow replay is constrained by subject, action, resource, environment, input,
  policy, attributes, time, evaluator, and decision digests.
- Stale authorization is constrained by finite lifetime, invalidation, and
  mandatory apply-time re-evaluation.
- Evaluator compromise remains a high-impact risk; independent gateway
  validation, least privilege, implementation identity, fail-closed behavior,
  and evidence reduce but do not eliminate it.
- Evidence leakage is constrained by references and digests instead of raw
  claims, attributes, policy, and provider data.
- Denial of service is constrained by request, statement, attribute, resource,
  constraint, obligation, time, and diagnostic bounds; availability loss still
  produces deny.

Implementation requires a threat-model impact review covering the selected
policy evaluator library/process, attribute adapters, bundle loading,
revocation, and timing side channels. No evaluator or adapter is accepted by
this RFC.

## Compatibility

`authorization_request_version`, `evaluation_version`, and
`authorization_decision_version` govern record shape and semantics independently.
Clients cannot supply or negotiate internal evaluation or decision versions.

Adding optional evidence metadata is compatible only when old enforcers can
ignore it without changing authority. Any new subject kind, delegation model,
effect, decision effect/basis, constraint, obligation, combining algorithm,
attribute authority, cache reuse, or rule that can widen authorization requires
a new contract version and RFC review.

Constraint and obligation types are versioned registries. Unknown types always
deny; they are never ignored for forward compatibility. Policy bundle revisions
are immutable. Updating a bundle creates a new revision and invalidates affected
decisions and plans.

Reason codes may be added without widening authority when they preserve effect
and basis semantics and pass redaction review. Human-readable reason text is not
part of compatibility or authority.

## Validation and acceptance evidence

Implementation under #3 is complete only when machine-readable schemas and a
network-free reference evaluator/enforcer pass:

- valid synthetic explicit-allow, explicit-deny, default-deny, error-deny, and
  indeterminate-deny examples;
- deterministic combining independent of statement and resource order;
- property/generative tests proving deny monotonicity when constraints or
  failures are added;
- negative cross-subject/resource/environment/version/input/policy replay tests;
- constraint intersection and obligation accumulation/conflict fixtures;
- stale attribute, policy change, revocation, forbidden reuse, and apply-time
  re-evaluation fixtures;
- stable sanitized diagnostics and evidence without sensitive values;
- strict bounds for every collection, record, lifetime, and evaluator response.

## Rollout and rollback

1. Accept this RFC explicitly through human review.
2. Add network-free authorization request, evaluation, decision, constraint,
   obligation, and evidence schemas.
3. Implement the deterministic combiner and gateway enforcement checks without
   an external evaluator, identity adapter, listener, or provider.
4. Add entirely synthetic negative, failure, replay, and property tests.
5. Review threat-model impact and compatibility evidence.
6. Use the accepted contract to constrain #4, #6, #8, and #9.

Before release or consumer integration, rollback removes the unaccepted
implementation and returns to the accepted documentation-only boundary. After
publication, previous exact record and registry versions remain immutable for
their support window; rollback never changes an existing policy revision or
reuses a decision under different bindings.

## Alternatives

### Authentication implies authorization

Rejected because identity proof contains no capability, resource, environment,
effect, or current-policy decision.

### Trust the policy engine's boolean

Rejected because a boolean cannot prove exact bindings, freshness, policy
revision, constraints, obligations, evaluator identity, or failure basis.

### Use allow, deny, and unknown as peer outcomes

Rejected because callers or adapters could accidentally treat unknown as a
retryable or permissive state. Unknown and error are recorded as deny bases.

### First applicable rule wins

Rejected because rule ordering becomes authority and can hide explicit deny or
evaluation failure. Version 1 uses deterministic deny override and safe
intersection.

### Permit partial authorization for resource sets

Rejected for version 1 because clients could confuse requested and authorized
subsets or apply one approval to a changed set. Requests may be split into
separately authorized operations.

### Send raw policy and attributes to audit

Rejected because evidence would become a disclosure channel for secrets,
personal data, policy internals, and sensitive topology.

## Open questions

The project owner approved the proposed resolutions on 2026-08-03:

1. Version 1 excludes delegation and impersonation, including agent-on-behalf-of
   chains. A future delegation model requires its own RFC.
2. Multi-resource authorization is all-or-nothing; partial authorization is not
   representable in version 1.
3. Allow decisions are never reused in version 1. Every invocation is evaluated
   again under current bindings.
4. Policy emits the generic `approval_required` obligation. The approval
   mechanism and exact plan binding belong to #4.
5. Version 1 subject kinds are `human` and `workload`; an agent is represented
   through workload identity and receives no special authority kind.

No design question remains open. This accepted record is immutable; future
changes require a superseding RFC and compatibility review.
